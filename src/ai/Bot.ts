import type * as THREE from 'three';
import type { Car } from '../game/Car';
import type { Racer } from '../game/Race';
import { parseVector } from '../torque/TorqueMath';
import type { VehicleMove } from '../vehicle/WheeledVehicle';
import type { Track } from '../world/Track';
import { Autopilot } from './Autopilot';

/** Seconds a wrecked or hopelessly stuck bot waits before it reappears (native `onDestroy`). */
const RESPAWN_SECONDS = 4;

/**
 * A computer driver (`AIClientVeh` in aiclientveh.cs): drives Path1 then Path3 marker by marker, forever,
 * and goes back to its last checkpoint when it wrecks or stays stuck.
 */
export class Bot {
    readonly autopilot: Autopilot;
    private readonly _paths: THREE.Vector3[][];
    private _path = 0;
    private _node = 0;
    /** Path and node when the bot crossed its last correct checkpoint (`markPathIndex`, `markLastNodeIndex`). */
    private _markPath = 0;
    private _markNode = 0;
    private _respawnTimer = 0;

    constructor(
        readonly car: Car,
        readonly racer: Racer,
        track: Track,
        index: number,
    ) {
        this.autopilot = new Autopilot(car.vehicle);
        this._paths = botPaths(track, index);
        this.autopilot.onReach = () => this._moveToNextNode();
        this.autopilot.onGiveUp = () => this.wreck();
    }

    /** Whether the bot is waiting to respawn. */
    get isWrecked(): boolean {
        return this._respawnTimer > 0;
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
     * Takes the bot out of the race for a few seconds, then puts it back at its last checkpoint.
     */
    wreck(): void {
        this._respawnTimer = RESPAWN_SECONDS;
    }

    /**
     * Returns the move for the next tick.
     */
    nextMove(dt: number): VehicleMove {
        if (this._respawnTimer > 0) {
            this._respawnTimer -= dt;
            if (this._respawnTimer <= 0) this._respawn();
            return { throttle: 0, yaw: 0, brake: true, jet: false };
        }
        return this.autopilot.nextMove();
    }

    private _respawn(): void {
        const cp = this.racer.lastCheckpoint;
        this.car.place(cp.position, cp.rotation);
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
