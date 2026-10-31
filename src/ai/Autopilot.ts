import * as THREE from 'three';
import type { VehicleMove, WheeledVehicle } from '../vehicle/WheeledVehicle';

const _local = new THREE.Vector3();
const _inv = new THREE.Quaternion();

/**
 * Drives a car toward a world point by producing moves, like the engine's AI `setMoveDestination`.
 *
 * The original native code is not in the scripts; this steers the front wheels at the target,
 * eases off the throttle in sharp turns and backs up when stuck.
 */
export class Autopilot {
    /** Where the car is heading, or `null` to stop. */
    readonly destination = new THREE.Vector3();
    hasDestination = false;
    /** Throttle on straights (0 to 1). Slow zones lower it. */
    maxThrottle = 1;
    /** Distance at which the destination counts as reached. */
    tolerance = 12;
    /** Called once when the car gets within {@link tolerance} of the destination. */
    onReach: (() => void) | null = null;

    private _stuckTime = 0;
    private _reverseTime = 0;

    constructor(private readonly _vehicle: WheeledVehicle) {}

    /**
     * Sets a new destination.
     */
    moveTo(point: THREE.Vector3): void {
        this.destination.copy(point);
        this.hasDestination = true;
    }

    stop(): void {
        this.hasDestination = false;
    }

    /**
     * Returns the move for the next tick.
     */
    nextMove(dt: number): VehicleMove {
        const v = this._vehicle;
        const move: VehicleMove = { throttle: 0, yaw: 0, brake: false, jet: false };
        if (!this.hasDestination) {
            move.brake = true;
            return move;
        }

        const rigid = v.rigid;
        _local.copy(this.destination).sub(rigid.linPosition).applyQuaternion(_inv.copy(rigid.angPosition).invert());
        const flatDistance = Math.hypot(_local.x, _local.y);
        if (flatDistance < this.tolerance) {
            this.hasDestination = false;
            this.onReach?.();
            return this.nextMove(dt);
        }

        // Angle to the target, positive to the right (+X of the body).
        const angle = Math.atan2(_local.x, _local.y);
        const max = v.data.maxSteeringAngle;
        // Physics turns by steering * |steering|, so take the square root to aim the wheels at the target.
        const wanted = Math.sign(angle) * Math.min(Math.sqrt(Math.abs(angle)), max);

        if (this._reverseTime > 0) {
            this._reverseTime -= dt;
            move.throttle = -1;
            move.yaw = -THREE.MathUtils.clamp(wanted, -max, max) - v.steering;
            return move;
        }

        move.yaw = THREE.MathUtils.clamp(wanted, -max, max) - v.steering;
        const sharp = Math.abs(angle) > Math.PI / 4;
        move.throttle = sharp ? this.maxThrottle * 0.5 : this.maxThrottle;
        if (Math.abs(angle) > Math.PI / 2 && v.speed > 20) move.brake = true;

        // Stuck against something: back up for a moment.
        if (v.speed < 1.5) this._stuckTime += dt;
        else this._stuckTime = 0;
        if (this._stuckTime > 1.5) {
            this._stuckTime = 0;
            this._reverseTime = 1.2;
        }
        return move;
    }
}
