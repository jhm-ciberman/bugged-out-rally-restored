import * as THREE from 'three';
import type { VehicleMove, WheeledVehicle } from '../vehicle/WheeledVehicle';

/** Half-size of the square (world X and Y) in which a destination counts as reached (native default). */
const ARRIVE_TOLERANCE = 12;
/** A car that stays within this distance of where it was counts as stuck. */
const STUCK_RADIUS = 2.5;
/** Stuck ticks before backing up with the steering reversed. */
const STUCK_REVERSE_TICKS = 50;
/** Stuck ticks before giving up and respawning at the last checkpoint. */
const STUCK_RESPAWN_TICKS = 300;
/** Throttle on straights, and in sharp turns. Bot moves are not clamped to 1 (`Move::clamp` is for the network). */
const BASE_THROTTLE = 1.1;
const TURN_THROTTLE = 0.6;
/** Heading alignment (cosine) below which a turn counts as sharp. */
const SHARP_TURN_ALIGNMENT = 0.2;
/** Speeds of the native speed governor. The unit is not known; km/h fits the numbers best. */
const TURN_BRAKE_SPEED = 40;
const SLOW_ZONE_COAST_SPEED = 100;
const SLOW_ZONE_BRAKE_SPEED = 140;

const _local = new THREE.Vector3();
const _toGoal = new THREE.Vector3();
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

    /** Where the car was when it last moved freely; stuck means staying near it. */
    private readonly _stuckOrigin = new THREE.Vector3();
    private _stuckTicks = 0;
    /** Direction from where the car was to the destination when it was set (for the "passed it" test). */
    private readonly _segment = new THREE.Vector3();

    constructor(private readonly _vehicle: WheeledVehicle) {}

    moveTo(point: THREE.Vector3): void {
        this.destination.copy(point);
        this.hasDestination = true;
        this._segment.subVectors(point, this._vehicle.rigid.linPosition).normalize();
    }

    /**
     * Forgets the stuck state, for example after a respawn.
     */
    reset(): void {
        this._stuckTicks = 0;
        this._stuckOrigin.copy(this._vehicle.rigid.linPosition);
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
        // Reached: inside a square around the destination, or already past it along the way it was set.
        _toGoal.subVectors(this.destination, rigid.linPosition);
        const inSquare = Math.abs(_toGoal.x) < ARRIVE_TOLERANCE && Math.abs(_toGoal.y) < ARRIVE_TOLERANCE;
        if (inSquare || _toGoal.dot(this._segment) < 0) {
            this.hasDestination = false;
            this.onReach?.();
            if (!this.hasDestination) return move;
            return this.nextMove();
        }

        _local.copy(_toGoal).applyQuaternion(_inv.copy(rigid.angPosition).invert());
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
        move.throttle = throttle;
        move.yaw = wanted - v.steering;

        // Stuck (native AI tick, 0x4c9c96): a car that stays within 2.5 m of where it was keeps counting.
        // Past 50 ticks it backs up with the wheels turned the other way until it gets 2.5 m away;
        // past 300 it gives up. Moving away resets the count.
        if (this._stuckOrigin.distanceTo(rigid.linPosition) >= STUCK_RADIUS) {
            this._stuckOrigin.copy(rigid.linPosition);
            this._stuckTicks = 0;
        } else {
            this._stuckTicks++;
        }
        if (this._stuckTicks > STUCK_RESPAWN_TICKS) {
            this._stuckTicks = 0;
            this.onGiveUp?.();
        } else if (this._stuckTicks > STUCK_REVERSE_TICKS) {
            move.throttle = -1;
            move.brake = false;
            move.yaw = -Math.sign(wanted || 1) * max - v.steering;
        }
        return move;
    }
}
