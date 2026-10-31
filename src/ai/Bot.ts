import * as THREE from 'three';
import type { Car } from '../game/Car';
import type { Racer } from '../game/Race';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { parseVector } from '../torque/TorqueMath';
import type { VehicleMove } from '../vehicle/WheeledVehicle';
import type { Track } from '../world/Track';
import { Autopilot } from './Autopilot';

/** Seconds between line-of-sight checks (native AI think rate). */
const LOS_CHECK_SECONDS = 0.5;
/** Seconds between shots while a target is in sight (`singleShot` reschedules itself). */
const SHOT_SECONDS = 1;
/** Reach and cone of the line-of-sight test. Not decoded from the exe; chosen to match the homing cone. */
const LOS_RANGE = 300;
const LOS_CONE = 0.7;

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

    private _losTimer = 0;
    private _ahead: Car | null = null;
    private _behind: Car | null = null;
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
     * a Zinger every second while a car is in sight ahead, a Magno bomb every second while one is behind.
     *
     * The line-of-sight test is native code; this one looks for a car within a 45 degree cone and 300 m,
     * with nothing solid in between, twice a second.
     */
    triggers(dt: number, cars: readonly Car[], world: CollisionWorld): { fire: boolean; drop: boolean } {
        this._losTimer -= dt;
        if (this._losTimer <= 0) {
            this._losTimer = LOS_CHECK_SECONDS;
            this._ahead = this._findInSight(cars, world, 1);
            this._behind = this._findInSight(cars, world, -1);
        }
        let fire = false;
        let drop = false;
        this._shotTimer -= dt;
        this._behindShotTimer -= dt;
        if (this._ahead && this._shotTimer <= 0) {
            fire = true;
            this._shotTimer = SHOT_SECONDS;
        }
        if (this._behind && this._behindShotTimer <= 0) {
            drop = true;
            this._behindShotTimer = SHOT_SECONDS;
        }
        return { fire, drop };
    }

    private _findInSight(cars: readonly Car[], world: CollisionWorld, side: 1 | -1): Car | null {
        const rigid = this.car.vehicle.rigid;
        const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(rigid.angPosition).multiplyScalar(side);
        const eye = rigid.worldCenterOfMass;
        for (const other of cars) {
            if (other === this.car || other.respawnTimer > 0) continue;
            const to = other.vehicle.rigid.worldCenterOfMass.clone().sub(eye);
            const distance = to.length();
            if (distance > LOS_RANGE || distance < 1) continue;
            if (forward.dot(to.divideScalar(distance)) < LOS_CONE) continue;
            if (!world.castRay(eye, other.vehicle.rigid.worldCenterOfMass)) return other;
        }
        return null;
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
