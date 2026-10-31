import * as THREE from 'three';
import type { VehicleMove, WheeledVehicle } from '../vehicle/WheeledVehicle';

/** Distance at which a destination counts as reached (native default). */
const ARRIVE_TOLERANCE = 12;
/** A car that moves less than this between ticks counts as stuck. */
const STUCK_DISTANCE = 2.5;
/** Stuck ticks before backing up with the steering reversed. */
const STUCK_REVERSE_TICKS = 50;
/** Stuck ticks before giving up and respawning at the last checkpoint. */
const STUCK_RESPAWN_TICKS = 300;
/** Ticks spent backing up each time the car is found stuck. */
const REVERSE_TICKS = 40;
/** Throttle on straights, and in sharp turns. Moves clamp it to 1. */
const BASE_THROTTLE = 1.1;
const TURN_THROTTLE = 0.6;
/** Heading alignment (cosine) below which a turn counts as sharp. */
const SHARP_TURN_ALIGNMENT = 0.2;
/** Speeds of the native speed governor. The unit is not known; km/h fits the numbers best. */
const TURN_BRAKE_SPEED = 40;
const SLOW_ZONE_COAST_SPEED = 100;
const SLOW_ZONE_BRAKE_SPEED = 140;

const _local = new THREE.Vector3();
const _inv = new THREE.Quaternion();

/**
 * Drives a car toward a destination by producing moves: the native part of the original `AIClientVeh`
 * (`setMoveDestination`, decoded from the exe).
 */
export class Autopilot {
    readonly destination = new THREE.Vector3();
    hasDestination = false;
    /** Set while in a slow zone: the bot holds its speed down. */
    slow = false;
    /** Called once when the car gets within reach of the destination. */
    onReach: (() => void) | null = null;
    /** Called when the car has been stuck too long and should respawn. */
    onGiveUp: (() => void) | null = null;

    private readonly _lastSample = new THREE.Vector3();
    private _stuckTicks = 0;
    private _reverseTicks = 0;

    constructor(private readonly _vehicle: WheeledVehicle) {}

    moveTo(point: THREE.Vector3): void {
        this.destination.copy(point);
        this.hasDestination = true;
    }

    /**
     * Forgets the stuck state, for example after a respawn.
     */
    reset(): void {
        this._stuckTicks = 0;
        this._reverseTicks = 0;
        this._lastSample.copy(this._vehicle.rigid.linPosition);
    }

    /**
     * Returns the move for the next tick.
     */
    nextMove(): VehicleMove {
        const v = this._vehicle;
        const move: VehicleMove = { throttle: 0, yaw: 0, brake: false, jet: false };
        if (!this.hasDestination) {
            move.brake = true;
            return move;
        }

        const rigid = v.rigid;
        _local.copy(this.destination).sub(rigid.linPosition).applyQuaternion(_inv.copy(rigid.angPosition).invert());
        if (Math.hypot(_local.x, _local.y) < ARRIVE_TOLERANCE) {
            this.hasDestination = false;
            this.onReach?.();
            if (!this.hasDestination) return move;
            return this.nextMove();
        }

        // Angle to the goal, positive to the right. The physics steers by s*|s|, so aim with the square root.
        const angle = Math.atan2(_local.x, _local.y);
        const max = v.data.maxSteeringAngle;
        const wanted = Math.sign(angle) * Math.min(Math.sqrt(Math.abs(angle)), max);
        const speed = v.speed * 3.6;

        const alignment = Math.cos(angle);
        let throttle = BASE_THROTTLE;
        if (alignment < SHARP_TURN_ALIGNMENT) {
            throttle = TURN_THROTTLE;
            if (speed > TURN_BRAKE_SPEED) move.brake = true;
        }
        if (this.slow) {
            if (speed > SLOW_ZONE_BRAKE_SPEED) move.brake = true;
            else if (speed > SLOW_ZONE_COAST_SPEED) throttle = 0;
            else throttle = Math.min(throttle, 1);
        }
        move.throttle = Math.min(throttle, 1);
        move.yaw = wanted - v.steering;

        // Stuck: back up with the wheels turned the other way for a moment, then give up.
        // The native code samples "moved less than 2.5 units"; per 32 ms tick that reads as below 2.5 m/s here.
        const moved = this._lastSample.distanceTo(rigid.linPosition);
        this._lastSample.copy(rigid.linPosition);
        if (this._reverseTicks > 0) {
            this._reverseTicks--;
            move.throttle = -1;
            move.brake = false;
            move.yaw = -wanted - v.steering;
            return move;
        }
        if (moved < STUCK_DISTANCE * 0.032) this._stuckTicks++;
        else this._stuckTicks = 0;
        if (this._stuckTicks > STUCK_RESPAWN_TICKS) {
            this._stuckTicks = 0;
            this.onGiveUp?.();
        } else if (this._stuckTicks > 0 && this._stuckTicks % STUCK_REVERSE_TICKS === 0) {
            this._reverseTicks = REVERSE_TICKS;
        }
        return move;
    }
}
