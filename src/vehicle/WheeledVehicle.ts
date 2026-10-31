import * as THREE from 'three';
import type { CollisionWorld, Contact } from '../physics/CollisionWorld';
import { Rigid } from '../physics/Rigid';
import type { VehicleData, WheelMount } from './VehicleData';

/** Length of one simulation tick, in seconds (`TickSec`, 32 ms). */
export const TICK_SECONDS = 0.032;

/** Gravity used by wheeled vehicles (`sWheeledVehicleGravity`). */
const GRAVITY = -20;
/** Fraction of the gravity energy below which a touching vehicle counts as resting (`sRestTol`). */
const REST_TOLERANCE = 0.5;
/** Consecutive resting sub-steps before the body goes to sleep (`sRestCount`). */
const REST_COUNT = 10;
/** Most impulse passes per sub-step, a safety net for the engine's open-ended loop. */
const MAX_COLLISION_PASSES = 16;

/**
 * The controls applied during one tick (Torque's `Move`).
 */
export interface VehicleMove {
    /** Throttle: 1 forward, -1 reverse. */
    throttle: number;
    /** Steering change this tick, in radians. Positive turns right. */
    yaw: number;
    brake: boolean;
    jet: boolean;
}

/**
 * The live state of one wheel.
 */
export interface WheelState {
    readonly mount: WheelMount;
    /** Suspension extension: 0 fully compressed, 1 fully extended. */
    extension: number;
    /** Angular velocity, in radians per second. */
    avel: number;
    /** Spin angle as a fraction of a turn (0 to 1). */
    apos: number;
    /** Longitudinal and lateral tire deformation. */
    Dy: number;
    Dx: number;
    slip: number;
    slipping: boolean;
    torqueScale: number;
    contact: boolean;
    readonly contactNormal: THREE.Vector3;
    readonly contactPoint: THREE.Vector3;
}

const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _r = new THREE.Vector3();
const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const _f = new THREE.Vector3();
const _tireX = new THREE.Vector3();
const _tireY = new THREE.Vector3();
const _wheelX = new THREE.Vector3();
const _end = new THREE.Vector3();
const UP = new THREE.Vector3(0, 0, 1);

/**
 * A car simulated with the Torque `WheeledVehicle` model (`game/vehicles/wheeledVehicle.cc` and `vehicle.cc`):
 * a rigid body on ray-cast spring wheels with deforming tires.
 *
 * Call {@link tick} every 32 ms of game time.
 */
export class WheeledVehicle {
    readonly rigid = new Rigid();
    readonly wheels: WheelState[];
    /** Current steering angle, in radians. Positive turns right. */
    steering = 0;
    throttle = 0;
    braking = false;
    jetting = false;
    energy: number;
    /** Chase camera lag offset, in world space (`mCameraOffset`). */
    readonly cameraOffset = new THREE.Vector3();
    /** Called when the body hits something harder than `minImpactSpeed`, with the change of velocity. */
    onImpact: ((velocityChange: THREE.Vector3) => void) | null = null;

    private _restCount = 0;
    private readonly _contacts: Contact[] = [];
    private readonly _hullWorld: THREE.Vector3[];

    constructor(
        readonly data: VehicleData,
        private readonly _world: CollisionWorld,
    ) {
        const r = this.rigid;
        r.setMass(data.mass);
        r.friction = data.bodyFriction;
        r.restitution = data.bodyRestitution;
        r.setCenterOfMass(data.massCenter);
        r.setObjectInertiaBox(data.inertiaBox);
        this.energy = data.maxEnergy;
        this.wheels = data.wheels.map((mount) => ({
            mount,
            extension: 1,
            avel: 0,
            apos: 0,
            Dy: 0,
            Dx: 0,
            slip: 0,
            slipping: false,
            torqueScale: 0,
            contact: false,
            contactNormal: new THREE.Vector3(0, 0, 1),
            contactPoint: new THREE.Vector3(),
        }));
        this._hullWorld = data.collisionHull.map(() => new THREE.Vector3());
    }

    /**
     * Places the car and stops it.
     */
    setTransform(position: THREE.Vector3, rotation: THREE.Quaternion): void {
        this.rigid.setTransform(position, rotation);
        this.rigid.setAtRest();
        this.rigid.atRest = false;
        this.steering = 0;
        for (const w of this.wheels) {
            w.avel = 0;
            w.Dx = 0;
            w.Dy = 0;
        }
    }

    /**
     * Speed of the body in meters per second.
     */
    get speed(): number {
        return this.rigid.linVelocity.length();
    }

    /**
     * Runs one 32 ms tick with the given controls (`Vehicle::processTick`).
     */
    tick(move: VehicleMove): void {
        this._updateMove(move);
        const count = this.data.integration;
        for (let i = 0; i < count; i++) this._updatePos(TICK_SECONDS / count);
    }

    /**
     * Advances the per-frame visuals: wheel spin and camera lag (`advanceTime`).
     */
    advanceTime(dt: number): void {
        for (const w of this.wheels) {
            w.apos += (w.avel * dt) / (Math.PI * 2);
            w.apos -= Math.floor(w.apos);
        }
        _v.copy(this.cameraOffset)
            .multiplyScalar(this.data.cameraDecay)
            .addScaledVector(this.rigid.linVelocity, this.data.cameraLag);
        this.cameraOffset.addScaledVector(_v, -dt);
    }

    private _updateMove(move: VehicleMove): void {
        this.throttle = move.throttle;
        this.braking = move.brake;
        const max = this.data.maxSteeringAngle;
        this.steering = THREE.MathUtils.clamp(this.steering + move.yaw, -max, max);

        if (move.jet) {
            if (!this.jetting && this.energy >= this.data.minJetEnergy) this.jetting = true;
            if (this.jetting) {
                this.energy -= this.data.jetEnergyDrain;
                if (this.energy < 0) {
                    this.energy = 0;
                    this.jetting = false;
                }
            }
        } else {
            this.jetting = false;
        }
    }

    private _updatePos(dt: number): void {
        const r = this.rigid;
        const origVelocity = r.linVelocity.clone();
        r.clearForces();
        this._updateForces(dt);

        let collided = false;
        if (!r.atRest) {
            collided = this._updateCollision(dt);
            if (this._contacts.length > 0) {
                const k = r.getKineticEnergy();
                const g = GRAVITY * dt;
                const kg = 0.5 * r.mass * g * g;
                if (k < REST_TOLERANCE * kg && ++this._restCount > REST_COUNT) r.setAtRest();
            } else {
                this._restCount = 0;
            }
        }

        if (!r.atRest) r.integrate(dt);

        if (collided && this.onImpact) {
            const change = r.linVelocity.clone().sub(origVelocity);
            if (change.length() > this.data.minImpactSpeed) this.onImpact(change);
        }
    }

    /**
     * Sets each wheel's suspension extension by casting a ray from its spring mount
     * down to the bottom of the tire (`WheeledVehicle::extendWheels`).
     */
    extendWheels(): void {
        const r = this.rigid;
        for (const w of this.wheels) {
            const { spring, tire } = w.mount;
            w.extension = 1;
            const sp = _pos.copy(w.mount.position).applyQuaternion(r.angPosition).add(r.linPosition);
            const vec = _v.set(0, 0, -spring.length).applyQuaternion(r.angPosition);
            let ts = tire.radius / spring.length;
            const ep = _end.copy(sp).addScaledVector(vec, 1 + ts);
            ts = ts / (1 + ts);
            const hit = this._world.castRay(sp, ep);
            if (hit) {
                w.contact = true;
                w.extension = hit.t < ts ? 0 : (hit.t - ts) / (1 - ts);
                w.contactNormal.copy(hit.normal);
                w.contactPoint.copy(hit.point);
            } else {
                w.contact = false;
                w.slipping = true;
            }
        }
    }

    private _updateForces(dt: number): void {
        this.extendWheels();
        const r = this.rigid;
        const data = this.data;
        const aMomentum = r.mass / this.wheels.length;

        _bx.set(1, 0, 0).applyQuaternion(r.angPosition);
        _by.set(0, 1, 0).applyQuaternion(r.angPosition);
        _bz.set(0, 0, 1).applyQuaternion(r.angPosition);

        const quadraticSteering = -(this.steering * Math.abs(this.steering));
        const cosSteering = Math.cos(quadraticSteering);
        const sinSteering = Math.sin(quadraticSteering);

        let engineTorque = 0;
        let brakeVel = 0;
        if (this.braking) {
            brakeVel = (data.brakeTorque / aMomentum) * dt;
        } else if (this.throttle) {
            engineTorque = data.engineTorque * this.throttle;
            // Double the torque to help out the jets.
            if (this.throttle > 0 && this.jetting) engineTorque *= 2;
        } else {
            brakeVel = (data.engineBrake / aMomentum) * dt;
        }

        r.force.set(0, 0, 0);
        r.torque.set(0, 0, 0);

        for (const w of this.wheels) {
            const { tire, spring } = w.mount;
            let Fy = 0;
            if (w.contact) {
                _pos.copy(w.mount.position).applyQuaternion(r.angPosition).add(r.linPosition);
                r.getOriginVector(_pos, _r);
                const localVel = r.getVelocity(_r, new THREE.Vector3());

                const springForce = spring.force * (1 - w.extension);

                if (w.extension === 0) {
                    // Fully compressed: keep the body from sinking through the ground.
                    const n = -localVel.dot(UP);
                    if (n >= 0) {
                        const j = n * (1 + r.restitution) * r.getZeroImpulse(_r, UP);
                        r.force.addScaledVector(UP, j);
                    }
                }

                let damping = spring.damping * -(_bz.dot(localVel) / spring.length);
                if (damping < 0) damping = 0;

                let antiSway = 0;
                if (w.mount.opposite !== -1) {
                    const other = this.wheels[w.mount.opposite];
                    if (other.contact) antiSway = (other.extension - w.extension) * spring.antiSway;
                    if (antiSway < 0) antiSway = 0;
                }

                // Spring forces act straight up the body, at the spring root.
                _f.copy(_bz).multiplyScalar(springForce + damping + antiSway);
                r.torque.add(_t.crossVectors(_r, _f));
                r.force.add(_f);

                // Tire axes, perpendicular to the ground normal.
                _wheelX
                    .copy(_bx)
                    .multiplyScalar(cosSteering)
                    .addScaledVector(_by, sinSteering * w.mount.steering);
                _tireY.crossVectors(w.contactNormal, _wheelX).normalize();
                _tireX.crossVectors(_tireY, w.contactNormal).normalize();

                r.getOriginVector(w.contactPoint, _r);
                const wheelVelocity = r.getVelocity(_r, new THREE.Vector3());
                const xVelocity = _tireX.dot(wheelVelocity);
                const yVelocity = _tireY.dot(wheelVelocity);

                // Longitudinal tire deformation.
                const ddy = w.avel * tire.radius - yVelocity - tire.longitudinalRelaxation * Math.abs(w.avel) * w.Dy;
                w.Dy += ddy * dt;
                Fy = tire.longitudinalForce * w.Dy + tire.longitudinalDamping * ddy;

                // Lateral tire deformation.
                const ddx = xVelocity - tire.lateralRelaxation * Math.abs(w.avel) * w.Dx;
                w.Dx += ddx * dt;
                let Fx = -(tire.lateralForce * w.Dx + tire.lateralDamping * ddx);

                let verticalLoad = springForce + damping + antiSway;
                if (verticalLoad < 0) verticalLoad = 0;

                // Friction circle.
                const mu = w.slipping ? tire.kineticFriction : tire.staticFriction;
                let Fn = verticalLoad * mu;
                Fn *= Fn;
                const Fw = Fx * Fx + Fy * Fy;
                if (Fw > Fn) {
                    const K = Math.sqrt(Fn / Fw);
                    Fy *= K;
                    Fx *= K;
                    w.Dy *= K;
                    w.Dx *= K;
                    w.slip = 1 - K;
                    w.slipping = true;
                } else {
                    w.slipping = false;
                    w.slip = 0;
                }

                // Tire forces act along the ground, at the hub.
                _f.copy(_tireX).multiplyScalar(Fx).addScaledVector(_tireY, Fy);
                _pos.addScaledVector(_bz, -spring.length * w.extension);
                r.getOriginVector(_pos, _r);
                r.torque.add(_t.crossVectors(_r, _f));
                r.force.add(_f);
            } else {
                w.torqueScale = 0;
                w.slip = 0;
                // Relax the tire deformation.
                w.Dy += -tire.longitudinalRelaxation * Math.abs(w.avel) * w.Dy * dt;
                w.Dx += -tire.lateralRelaxation * Math.abs(w.avel) * w.Dx * dt;
            }

            // All wheels are powered by default.
            const maxAvel = data.maxWheelSpeed / tire.radius;
            w.torqueScale = Math.abs(w.avel) > maxAvel ? 0 : 1 - Math.abs(w.avel) / maxAvel;
            w.avel += ((w.torqueScale * engineTorque - Fy * tire.radius) / aMomentum) * dt;

            // Brakes, after the torque so the wheel can come to a full stop.
            if (brakeVel > Math.abs(w.avel)) w.avel = 0;
            else if (w.avel > 0) w.avel -= brakeVel;
            else w.avel += brakeVel;
        }

        if (this.jetting) r.force.addScaledVector(_by, data.jetForce);

        // Drag (buoyancy comes with water support).
        r.force.addScaledVector(r.linVelocity, -data.drag);
        r.torque.addScaledVector(r.angMomentum, -data.drag);

        if (r.atRest && (r.force.lengthSq() > 0 || r.torque.lengthSq() > 0)) r.atRest = false;

        r.force.z += GRAVITY * r.mass;

        r.linMomentum.addScaledVector(r.force, dt);
        r.angMomentum.addScaledVector(r.torque, dt);
        r.updateVelocity();

        r.force.set(0, 0, 0);
        r.torque.set(0, 0, 0);
        if (r.atRest) r.setAtRest();
    }

    /**
     * Finds body contacts and resolves them with impulses and penalty forces (`Vehicle::updateCollision`).
     *
     * Returns whether an impact impulse was applied.
     */
    private _updateCollision(dt: number): boolean {
        const r = this.rigid;
        for (let i = 0; i < this._hullWorld.length; i++) {
            this._hullWorld[i].copy(this.data.collisionHull[i]).applyQuaternion(r.angPosition).add(r.linPosition);
        }
        this._contacts.length = 0;
        this._world.findContacts(this._hullWorld, r.worldCenterOfMass, this.data.collisionTol, this._contacts);
        const collided = this._resolveCollision();
        this._resolveContacts(dt);
        return collided;
    }

    private _resolveCollision(): boolean {
        const r = this.rigid;
        const tol = this.data.collisionTol;
        let collided = false;
        for (let pass = 0; pass < MAX_COLLISION_PASSES; pass++) {
            let colliding = false;
            for (const c of this._contacts) {
                if (c.distance >= tol) continue;
                r.getOriginVector(c.point, _r);
                r.getVelocity(_r, _v);
                if (_v.dot(c.normal) < -this.data.contactTol) {
                    r.resolveCollision(c.point, c.normal);
                    colliding = collided = true;
                }
            }
            if (!colliding) break;
        }
        return collided;
    }

    private _resolveContacts(dt: number): void {
        const r = this.rigid;
        const tol = this.data.collisionTol;
        const contactTol = this.data.contactTol;
        const p = new THREE.Vector3();
        const l = new THREE.Vector3();
        for (const c of this._contacts) {
            if (c.distance >= tol) continue;
            r.getOriginVector(c.point, _r);
            r.getVelocity(_r, _v);
            const vn = _v.dot(c.normal);
            if (Math.abs(vn) >= contactTol) continue;

            // Penetration spring that pushes the body out of the surface.
            const zi = 2 * Math.abs(r.getZeroImpulse(_r, c.normal));
            let s = (tol - c.distance) * zi - (vn / contactTol) * zi;
            _f.copy(c.normal).multiplyScalar(s);

            // Friction, up to what it takes to stop the sliding motion.
            const uv = _v.addScaledVector(c.normal, -vn);
            const ul = uv.length();
            if (s > 0 && ul) {
                uv.divideScalar(-ul);
                let u = ul * r.getZeroImpulse(_r, uv);
                s *= r.friction;
                if (u > s) u = s;
                _f.addScaledVector(uv, u);
            }
            p.add(_f);
            l.add(_t.crossVectors(_r, _f));
        }
        r.linMomentum.addScaledVector(p, dt);
        r.angMomentum.addScaledVector(l, dt);
        r.updateVelocity();
    }
}
