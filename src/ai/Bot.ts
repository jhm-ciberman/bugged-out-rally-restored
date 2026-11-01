import * as THREE from 'three';
import type { Car } from '../game/Car';
import type { Racer } from '../game/Race';
import { parseVector } from '../torque/TorqueMath';
import type { VehicleMove } from '../vehicle/WheeledVehicle';
import type { Track } from '../world/Track';
import { Autopilot } from './Autopilot';

/** Seconds between target scans (`getMoveList` runs the scan every 500 ms). */
const SCAN_SECONDS = 0.5;
/** Seconds between shots while a target stays in view (`singleShot` reschedules itself). */
const SHOT_SECONDS = 1;
/** Cosine of the half angle of the cone ahead, and the ranges ahead and behind, in meters (exe, 0x4ca620). */
const AHEAD_CONE = 0.7;
const AHEAD_MIN = 1;
const AHEAD_RANGE = 500;
const BEHIND_RANGE = 1000;

const _forward = new THREE.Vector3();
const _to = new THREE.Vector3();

/**
 * Whether a bot at `position`, facing `forward` (normalized), sees a target ahead or behind (`scanTargets` in the
 * exe). There is no line of sight test: ahead is a 3D cone within 500 m, behind is the whole rear half within
 * 1000 m. The scan stops at the first target ahead, so targets after it do not count as behind.
 */
export function scanTargets(
    position: THREE.Vector3,
    forward: THREE.Vector3,
    targets: Iterable<THREE.Vector3>,
): { ahead: boolean; behind: boolean } {
    let behind = false;
    for (const target of targets) {
        _to.subVectors(target, position);
        const distance = _to.length();
        if (distance === 0) continue;
        const dot = forward.dot(_to.divideScalar(distance));
        if (dot >= AHEAD_CONE) {
            if (distance >= AHEAD_MIN && distance <= AHEAD_RANGE) return { ahead: true, behind };
        } else if (dot < 0 && distance < BEHIND_RANGE) {
            behind = true;
        }
    }
    return { ahead: false, behind };
}

/**
 * A computer driver (`AIClientVeh` in aiclientveh.cs): drives Path1 then Path3 marker by marker, forever,
 * and picks the line up again from its last checkpoint after a respawn.
 */
export class Bot {
    readonly autopilot: Autopilot;
    private readonly _paths: THREE.Vector3[][];
    private _path = 0;
    private _node = 0;
    /** Path and node when the bot crossed its last correct checkpoint (`markPathIndex`, `markLastNodeIndex`). */
    private _markPath = 0;
    private _markNode = 0;

    private _scanTimer = SCAN_SECONDS;
    private _ahead = false;
    private _behind = false;
    private _shotTimer = 0;
    private _behindShotTimer = 0;

    constructor(
        readonly car: Car,
        readonly racer: Racer,
        track: Track,
        index: number,
    ) {
        this.autopilot = new Autopilot(car.vehicle);
        this._paths = botPaths(track, index);
        this.autopilot.onReach = () => this._moveToNextNode();
    }

    /**
     * Starts driving toward the first marker (`AIManager::start`).
     */
    start(): void {
        this._path = 0;
        this._node = 0;
        this._moveToNode();
    }

    /**
     * Remembers the current marker, for respawning (called on each correct checkpoint).
     */
    markCheckpoint(): void {
        this._markPath = this._path;
        this._markNode = this._node;
    }

    /**
     * Returns the move for the next tick.
     */
    nextMove(): VehicleMove {
        return this.autopilot.nextMove();
    }

    /**
     * Decides whether to shoot this tick (`onTargetEnterLOS` / `singleShot` / `behindShot` in aiclientveh.cs):
     * a Zinger as soon as a car comes into view ahead and then every second while one stays there, and a Magno
     * bomb the same way for cars behind.
     */
    triggers(dt: number, cars: readonly Car[]): { fire: boolean; drop: boolean } {
        let fire = false;
        let drop = false;
        this._scanTimer -= dt;
        if (this._scanTimer <= 0) {
            this._scanTimer += SCAN_SECONDS;
            const rigid = this.car.vehicle.rigid;
            _forward.set(0, 1, 0).applyQuaternion(rigid.angPosition);
            const targets = cars.filter((c) => c !== this.car && c.respawnTimer <= 0).map((c) => c.renderPosition);
            const seen = scanTargets(rigid.linPosition, _forward, targets);
            // The script shoots on the edge and reschedules itself; leaving the view cancels it.
            if (seen.ahead && !this._ahead) {
                fire = true;
                this._shotTimer = SHOT_SECONDS;
            }
            if (seen.behind && !this._behind) {
                drop = true;
                this._behindShotTimer = SHOT_SECONDS;
            }
            this._ahead = seen.ahead;
            this._behind = seen.behind;
        }
        if (this._ahead) {
            this._shotTimer -= dt;
            if (this._shotTimer <= 0 && !fire) {
                fire = true;
                this._shotTimer += SHOT_SECONDS;
            }
        }
        if (this._behind) {
            this._behindShotTimer -= dt;
            if (this._behindShotTimer <= 0 && !drop) {
                drop = true;
                this._behindShotTimer += SHOT_SECONDS;
            }
        }
        return { fire, drop };
    }

    /**
     * Picks up the racing line again from the marker saved at the last checkpoint, after a respawn
     * (`AIClientVeh::setRespawnPoint`).
     */
    respawned(): void {
        this.autopilot.reset();
        this._path = this._markPath;
        this._node = this._markNode;
        this._moveToNode();
    }

    private _moveToNextNode(): void {
        this._node++;
        if (this._node >= this._paths[this._path].length) {
            this._path = (this._path + 1) % this._paths.length;
            this._node = 0;
        }
        this._moveToNode();
    }

    private _moveToNode(): void {
        const target = this._paths[this._path]?.[this._node];
        if (target) this.autopilot.moveTo(target);
    }
}

/**
 * Returns the racing line of bot `index`: marker positions of Path1 and Path3, or Path2 and Path4
 * for bots 4 to 7 when the track has them (`AIManager::start`).
 */
export function botPaths(track: Track, index: number): THREE.Vector3[][] {
    const path = (name: string) => {
        const obj = track.objects.find((o) => o.className === 'Path' && o.name.toLowerCase() === name.toLowerCase());
        if (!obj) return null;
        return obj.children
            .filter((c) => c.className === 'Marker')
            .sort((a, b) => Number(a.fields.get('seqnum') ?? 0) - Number(b.fields.get('seqnum') ?? 0))
            .map((m) => parseVector(m.fields.get('position')));
    };
    const alternate = index >= 4 && index <= 7 && path('Path2');
    const names = alternate ? ['Path2', 'Path4'] : ['Path1', 'Path3'];
    return names.map(path).filter((p): p is THREE.Vector3[] => p !== null && p.length > 0);
}
