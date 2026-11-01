import * as THREE from 'three';
import { parseVector } from '../torque/TorqueMath';
import type { WheeledVehicle } from '../vehicle/WheeledVehicle';
import type { Track } from '../world/Track';
import { TriggerVolume } from '../world/TriggerVolume';

/** Laps in a race (`$Game::Laps`). */
export const RACE_LAPS = 3;
/** Seconds between position reports (`PlayerListGui::startTask`). */
const REPORT_SECONDS = 0.1;
/** Reports in a row going the wrong way before the warning (`getWrongWayCnt > 30`). */
const WRONG_WAY_REPORTS = 30;
/** Delay before the countdown starts, in seconds (`$Game::WaitTime`). */
const WAIT_SECONDS = 2;

const _toTarget = new THREE.Vector3();
const _move = new THREE.Vector3();

/**
 * Where the race is in its flow (`server/scripts/game.cs`).
 */
export type RacePhase = 'waiting' | 'countdown' | 'racing' | 'finished';

/**
 * One car in the race and its progress.
 */
export interface Racer {
    readonly name: string;
    readonly vehicle: WheeledVehicle;
    /** Completed laps. */
    lap: number;
    /** Number of the next checkpoint to cross; laps end on the one marked `isLast`. */
    nextCheck: number;
    /** Set on spawn, so the start line trigger the car sits in does not count as a wrong checkpoint. */
    resetting: boolean;
    /** Race time when each lap ended, in seconds. */
    readonly lapTimes: number[];
    /** Race time at the finish, or `null` while still racing. */
    finishTime: number | null;
    /** Where the car crossed its last valid checkpoint, used to put it back on the track. */
    readonly lastCheckpoint: { position: THREE.Vector3; rotation: THREE.Quaternion };
    /** Called when the racer crosses its next checkpoint in order. */
    onCheckpoint: (() => void) | null;
    /** Position reports in a row spent moving away from the next checkpoint while losing ground. */
    wrongWay: number;
    /** Where the car was at the last position report, and at the one before. */
    readonly reportedPosition: THREE.Vector3;
    readonly previousPosition: THREE.Vector3;
    /** Meters of the race covered, as of the last report (see {@link Race.standings}). */
    progress: number;
    /** Triggers the car is inside, to raise enter events once. */
    readonly inside: Set<TriggerVolume>;
}

/**
 * Things the race reports to the HUD and the sounds.
 */
export interface RaceEvents {
    /** The countdown shows `value` (3, 2, 1), then 0 for "go". */
    onCountdown?(value: number): void;
    /** Big centered message, such as "Checkpoint" or "Wrong Checkpoint!". */
    onCenterPrint?(racer: Racer, text: string): void;
    onLap?(racer: Racer): void;
    onFinish?(racer: Racer): void;
}

/**
 * The race rules: start countdown, checkpoints in order, laps and finish (`checkpoint.cs`, `game.cs`).
 */
export class Race {
    phase: RacePhase = 'waiting';
    /** Seconds since the green light. */
    time = 0;
    readonly racers: Racer[] = [];
    readonly checkpoints: TriggerVolume[];
    /** Where the marker of each checkpoint floats, by checkpoint number (`checkpointmarkerN`). */
    readonly markers = new Map<number, THREE.Vector3>();
    private _phaseTime = 0;
    private _reportTime = 0;
    private _count = 3;
    private _legLengths: number[] | null = null;

    constructor(
        track: Track,
        readonly events: RaceEvents = {},
    ) {
        this.checkpoints = track.objects
            .filter(
                (o) =>
                    o.className === 'Trigger' &&
                    (o.fields.get('datablock') ?? '').toLowerCase() === 'checkpointtrigger',
            )
            .map((o) => new TriggerVolume(o));
        for (const o of track.objects) {
            const m = /^checkpointmarker(\d+)$/i.exec(o.name);
            if (m) this.markers.set(Number(m[1]), parseVector(o.fields.get('position')));
        }
    }

    /**
     * Returns where the racer must go next: the marker of its next checkpoint.
     */
    nextCheckpointPosition(racer: Racer): THREE.Vector3 | undefined {
        return this.markers.get(racer.nextCheck);
    }

    /**
     * Returns the racer's place, starting at 1.
     */
    positionOf(racer: Racer): number {
        return this.standings().indexOf(racer) + 1;
    }

    /**
     * Returns the racers from first to last place: finishers by finish time, then the others by progress
     * (`getRacePosition`), with ties broken by checkpoints passed and distance to the next one.
     */
    standings(): Racer[] {
        const progress = (r: Racer) => r.lap * 100 + (r.nextCheck - 1);
        const distance = (r: Racer) => {
            const target = this.nextCheckpointPosition(r);
            return target ? target.distanceTo(r.vehicle.rigid.linPosition) : 0;
        };
        return [...this.racers].sort((a, b) => {
            if (a.finishTime !== null || b.finishTime !== null) {
                if (a.finishTime === null) return 1;
                if (b.finishTime === null) return -1;
                return a.finishTime - b.finishTime;
            }
            return b.progress - a.progress || progress(b) - progress(a) || distance(a) - distance(b);
        });
    }

    /**
     * Adds a car to the race, at its spawn pose.
     */
    addRacer(name: string, vehicle: WheeledVehicle): Racer {
        const racer: Racer = {
            name,
            vehicle,
            lap: 0,
            nextCheck: 1,
            resetting: true,
            lapTimes: [],
            finishTime: null,
            lastCheckpoint: {
                position: vehicle.rigid.linPosition.clone(),
                rotation: vehicle.rigid.angPosition.clone(),
            },
            onCheckpoint: null,
            wrongWay: 0,
            reportedPosition: vehicle.rigid.linPosition.clone(),
            previousPosition: vehicle.rigid.linPosition.clone(),
            progress: 0,
            inside: new Set(),
        };
        this.racers.push(racer);
        return racer;
    }

    /** Whether cars may drive (the throttle is locked before the green light). */
    get canDrive(): boolean {
        return this.phase === 'racing' || this.phase === 'finished';
    }

    /** Number of the last checkpoint of a lap. */
    get checkpointCount(): number {
        return this.checkpoints.reduce((n, c) => Math.max(n, Number(c.field('checkpoint') ?? 0)), 0);
    }

    /**
     * Advances the clock and checks every car against the checkpoints. Call once per physics tick.
     */
    tick(dt: number): void {
        this._phaseTime += dt;
        if (this.phase === 'waiting' && this._phaseTime >= WAIT_SECONDS) {
            this.phase = 'countdown';
            this._phaseTime = 0;
            this._count = 3;
            this.events.onCountdown?.(3);
        } else if (this.phase === 'countdown' && this._phaseTime >= 1) {
            this._phaseTime -= 1;
            this._count--;
            this.events.onCountdown?.(this._count);
            if (this._count === 0) this.phase = 'racing';
        }
        if (this.phase === 'racing' || this.phase === 'finished') this.time += dt;

        for (const racer of this.racers) this._checkTriggers(racer);

        // Position reports every 100 ms (`PlayerListGui::startTask`).
        this._reportTime += dt;
        if (this._reportTime >= REPORT_SECONDS) {
            this._reportTime -= REPORT_SECONDS;
            if (this.phase === 'racing') this._report();
        }
    }

    /**
     * Records where each racer is, re-scores everyone's progress and counts wrong-way reports, warning past 30
     * (about 3 s). The counter only grows while the car both heads away from its next checkpoint and loses
     * progress (`reportCurPosition` and `getRacePosition` in the exe's race list).
     */
    private _report(): void {
        for (const racer of this.racers) {
            if (racer.finishTime !== null) continue;
            racer.previousPosition.copy(racer.reportedPosition);
            racer.reportedPosition.copy(racer.vehicle.rigid.linPosition);
        }
        for (const racer of this.racers) {
            if (racer.finishTime !== null) continue;
            const before = racer.progress;
            racer.progress = this._progressOf(racer);
            const target = this.nextCheckpointPosition(racer);
            const heading = target
                ? _toTarget
                      .subVectors(target, racer.reportedPosition)
                      .dot(_move.subVectors(racer.reportedPosition, racer.previousPosition))
                : 0;
            racer.wrongWay = heading < 0 && before > racer.progress ? racer.wrongWay + 1 : 0;
            if (racer.wrongWay > WRONG_WAY_REPORTS) {
                this.events.onCenterPrint?.(racer, 'Wrong Way!');
                racer.wrongWay = 0;
            }
        }
    }

    /**
     * Meters of the race a racer has covered: whole laps, the legs between the checkpoints already passed, and the
     * part of the current leg done, measured as the leg's length less the distance left to its end.
     */
    private _progressOf(racer: Racer): number {
        const legs = this._legs();
        const count = legs.length;
        const target = this.nextCheckpointPosition(racer);
        if (count === 0 || !target) return 0;
        const lapLength = legs.reduce((a, b) => a + b, 0);
        let progress = racer.lap * lapLength;
        const left = target.distanceTo(racer.reportedPosition);
        // The last checkpoint passed: after a lap the racer heads from the last checkpoint back to the first.
        const passed = racer.nextCheck > 1 ? racer.nextCheck - 1 : racer.lap > 0 ? count : 0;
        if (passed === count) return progress + legs[0] - left;
        for (let j = 0; j < passed; j++) progress += legs[j];
        // On the other legs the exe truncates both lengths to whole meters and stops at zero.
        return progress + Math.max(0, Math.trunc(legs[passed]) - Math.trunc(left));
    }

    /**
     * Returns the length of each leg of a lap, by the checkpoint it ends at: the first ends at checkpoint 1,
     * coming from the last one.
     */
    private _legs(): number[] {
        if (this._legLengths) return this._legLengths;
        const count = this.markers.size;
        const legs: number[] = [];
        for (let k = 1; k <= count; k++) {
            const from = this.markers.get(k === 1 ? count : k - 1);
            const to = this.markers.get(k);
            legs.push(from && to ? from.distanceTo(to) : 0);
        }
        this._legLengths = legs;
        return legs;
    }

    private _checkTriggers(racer: Racer): void {
        const p = racer.vehicle.rigid.worldCenterOfMass;
        for (const trigger of this.checkpoints) {
            const inside = trigger.contains(p);
            if (inside && !racer.inside.has(trigger)) {
                racer.inside.add(trigger);
                this._enterCheckpoint(racer, trigger);
            } else if (!inside) {
                racer.inside.delete(trigger);
            }
        }
    }

    private _enterCheckpoint(racer: Racer, trigger: TriggerVolume): void {
        if (racer.finishTime !== null) return;
        const number = Number(trigger.field('checkpoint') ?? 0);
        if (racer.nextCheck < 1) racer.nextCheck = 1;
        if (racer.nextCheck === number) {
            this.events.onCenterPrint?.(racer, 'Checkpoint');
            racer.lastCheckpoint.position.copy(racer.vehicle.rigid.linPosition);
            racer.lastCheckpoint.rotation.copy(racer.vehicle.rigid.angPosition);
            racer.onCheckpoint?.();
            // Passing a checkpoint counts as a position report (`markCheckPoint`).
            racer.previousPosition.copy(racer.reportedPosition);
            racer.reportedPosition.copy(racer.vehicle.rigid.linPosition);
            if (trigger.field('islast') === '1') {
                racer.lap++;
                racer.lapTimes.push(this.time);
                if (racer.lap === RACE_LAPS) {
                    racer.finishTime = this.time;
                    this.events.onFinish?.(racer);
                    if (this.racers.every((r) => r.finishTime !== null)) this.phase = 'finished';
                } else {
                    racer.nextCheck = 1;
                    this.events.onLap?.(racer);
                }
            } else {
                racer.nextCheck++;
            }
        } else if (racer.resetting) {
            racer.resetting = false;
        } else {
            this.events.onCenterPrint?.(racer, 'Wrong Checkpoint!');
        }
    }
}
