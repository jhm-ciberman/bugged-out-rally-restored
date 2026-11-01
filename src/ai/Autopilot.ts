import * as THREE from 'three';
import type { VehicleMove, WheeledVehicle } from '../vehicle/WheeledVehicle';

/** Half-size of the square (world X and Y) in which a destination counts as reached (native default). */
const ARRIVE_TOLERANCE = 12;
/** A tick in which the car moves less than this counts toward being stuck (`getMoveList`, 0x4c9cfc). */
const STUCK_STEP = 2.5;
/** Stuck ticks before backing up with the steering reversed. */
const STUCK_REVERSE_TICKS = 50;
/** Stuck ticks before giving up and respawning at the last checkpoint. */
const STUCK_RESPAWN_TICKS = 300;
/** The steering correction is scaled this much, and negated, while backing up. */
const REVERSE_STEER_SCALE = -10;
/** Throttle on straights, and in sharp turns; the move takes the smaller of this and the target throttle. */
const BASE_THROTTLE = 1.1;
const TURN_THROTTLE = 0.6;
/** Target throttle, and the one in a slow zone above the coasting speed. */
const TARGET_THROTTLE = 1;
/** Alignment of the car's forward axis with the way to the destination below which a turn counts as sharp. */
const SHARP_TURN_ALIGNMENT = 0.2;
/** Speeds of the speed governor, in m/s. */
const TURN_BRAKE_SPEED = 40;
const SLOW_ZONE_COAST_SPEED = 100;
const SLOW_ZONE_BRAKE_SPEED = 140;
/** Push toward the destination given every tick, in N s: 0.1 m/s more per tick for a 200 kg car. */
const PUSH_IMPULSE = 20;

const _local = new THREE.Vector3();
const _way = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _arm = new THREE.Vector3();
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

    /** An item to steer at for the next tick only, and whether there is one. */
    private readonly _glance = new THREE.Vector3();
    private _glancing = false;
    /** Where the car was on the previous tick. */
    private readonly _lastPosition = new THREE.Vector3();
    private _stuck = false;
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
     * Steers at `point` instead of the destination for the next tick only, without moving the destination
     * (an item the bot saw ahead).
     */
    glanceAt(point: THREE.Vector3): void {
        this._glance.copy(point);
        this._glancing = true;
    }

    /**
     * Forgets the stuck state, for example after a respawn.
     */
    reset(): void {
        this._stuckTicks = 0;
        this._stuck = false;
        this._lastPosition.copy(this._vehicle.rigid.linPosition);
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
        // While glancing at an item, only the square counts: the way to the item says nothing about passing.
        if (inSquare || (!this._glancing && _toGoal.dot(this._segment) < 0)) {
            this._glancing = false;
            this.hasDestination = false;
            this.onReach?.();
            if (!this.hasDestination) return move;
            return this.nextMove();
        }

        // A glanced item takes over the steering, the alignment and the push for this one tick.
        if (this._glancing) _toGoal.subVectors(this._glance, rigid.linPosition);
        _local.copy(_toGoal).applyQuaternion(_inv.copy(rigid.angPosition).invert());
        // Angle to the goal, positive to the right. The physics steers by s*|s|, so aim with the square root.
        const angle = Math.atan2(_local.x, _local.y);
        const max = v.data.maxSteeringAngle;
        const wanted = Math.sign(angle) * Math.min(Math.sqrt(Math.abs(angle)), max);
        const speed = v.speed;
        _way.copy(_toGoal).normalize();
        const alignment = _way.dot(_forward.set(0, 1, 0).applyQuaternion(rigid.angPosition));

        // Stuck (`getMoveList`): every tick that moves less than 2.5 m counts. Past 50 the bot backs up with
        // the steering reversed until a tick moves it farther, and past 300 it gives up.
        if (rigid.linPosition.distanceTo(this._lastPosition) < STUCK_STEP) {
            this._stuck = true;
        } else {
            this._stuck = false;
            this._stuckTicks = 0;
        }
        if (this._stuck) this._stuckTicks++;
        move.yaw = wanted - v.steering;
        if (this._stuckTicks > STUCK_REVERSE_TICKS) {
            move.throttle = -1;
            move.yaw *= REVERSE_STEER_SCALE;
            if (this._stuckTicks > STUCK_RESPAWN_TICKS) {
                this._stuckTicks = 0;
                this.onGiveUp?.();
            }
            return move;
        }

        this._glancing = false;

        // The bots' edge: a push straight at the destination every tick, on top of the engine.
        if (alignment !== 0) {
            rigid.applyImpulse(rigid.getOriginVector(rigid.linPosition, _arm), _way.multiplyScalar(PUSH_IMPULSE));
        }

        let base = BASE_THROTTLE;
        let target = TARGET_THROTTLE;
        if (this.slow) {
            if (speed > SLOW_ZONE_BRAKE_SPEED) move.brake = true;
            else if (speed > SLOW_ZONE_COAST_SPEED) target = 0;
        }
        if (alignment < SHARP_TURN_ALIGNMENT) {
            base = TURN_THROTTLE;
            if (speed > TURN_BRAKE_SPEED) move.brake = true;
        }
        move.throttle = Math.min(base, target);
        this._lastPosition.copy(rigid.linPosition);
        return move;
    }
}
