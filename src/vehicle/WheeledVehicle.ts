import * as THREE from 'three';
import type { CollisionWorld, Contact } from '../physics/CollisionWorld';
import { Rigid } from '../physics/Rigid';
import { resolveCollisions, resolveContacts } from '../physics/RigidCollision';
import type { VehicleData, WheelMount } from './VehicleData';

/** Length of one simulation tick, in seconds (`TickSec`, 32 ms). */
export const TICK_SECONDS = 0.032;

/**
 * Gravity of wheeled vehicles in the shipped exe, scaled by the mission's `gravityMod`
 * (stock Torque uses -20; `WheeledVehicle::updateForces` in the exe uses -30).
 */
const GRAVITY = -30;
/** How far above the spring mount the wheel ray starts, so a wheel can be pressed past full compression (exe). */
const WHEEL_RAY_LIFT = 0.5;
/** Most a spring can push, as a multiple of its rated force, when pressed past full compression (exe). */
const MAX_SPRING_SCALE = 10;
/** Scale on the tire deformation rates (exe constant 1/0.91). */
const TIRE_RATE_SCALE = 1 / 0.91;
/** Limit on tire deformation (exe). */
const MAX_TIRE_DEFORMATION = 2;
/** Body tilt (up axis height) below which the self-righting torque acts (exe). */
const RIGHTING_TILT = 0.92;
/** Strength of the self-righting torque (exe). */
const RIGHTING_TORQUE = 90;
/** Tilt below which the car counts as upside down, and the physics steps before it is kicked over (exe). */
const FLIP_TILT = 0.2;
const FLIP_STEPS = 140;
/** Scale of `autoAlignForce`, which damps sideways and vertical body motion on the ground (exe). */
const AUTO_ALIGN_SCALE = 75;
/** Physics steps of being stuck (no momentum, or throttle below 5 m/s) before the car gives up (exe). */
const STUCK_STEPS = 500;
const STUCK_SPEED = 5;
/** Fraction of the gravity energy below which a touching vehicle counts as resting (`sRestTol`). */
const REST_TOLERANCE = 0.5;
/** Consecutive resting sub-steps before the body goes to sleep (`sRestCount`). */
const REST_COUNT = 10;
/** Steering kept on a tick without steering input (`Vehicle::updateMove` in the exe, 0x4bd46d). */
const STEERING_RETURN = 0.9;

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
    /** Extension without the lower clamp: negative when pressed past full compression. */
    rawExtension: number;
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
const _box = new THREE.Box3();
const _m = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);

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
    /** Jet energy. Cars start empty; boost pads fill it. */
    energy = 0;
    /** Chase camera lag offset, in world space (`mCameraOffset`). */
    readonly cameraOffset = new THREE.Vector3();
    /** Called when the body hits something harder than `minImpactSpeed`, with the change of velocity. */
    onImpact: ((velocityChange: THREE.Vector3) => void) | null = null;

    /**
     * Called when the car has been stuck too long or fell below the world (`onStuckOnZeroImpact`,
     * which wrecks it in the scripts).
     */
    onStuck: (() => void) | null = null;
    /** Fraction of the body under water, 0 to 1. */
    waterCoverage = 0;
    /** Tire grip multiplier from a physical zone such as ice (1 elsewhere). */
    surfaceFriction = 1;
    /** Force from the physical zones the car is in. */
    readonly appliedForce = new THREE.Vector3();
    private _stuckSteps = 0;
    private _flipSteps = 0;
    private _fallen = false;
    private _drag: number;
    private _buoyancy = 0;
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
        this._drag = data.drag;
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
            rawExtension: 1,
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
        this._fallen = false;
        this._stuckSteps = 0;
        this._flipSteps = 0;
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
        this._updateContainer();
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

    /**
     * Measures how deep the body is in water and sets drag and buoyancy (`ShapeBase::updateContainer`).
     */
    private _updateContainer(): void {
        this._drag = this.data.drag;
        this._buoyancy = 0;
        this.waterCoverage = 0;
        this.surfaceFriction = this._world.zoneEffects(this.rigid.linPosition, this.appliedForce);
        const water = this._world.water;
        const p = this.rigid.linPosition;
        if (!water || !this._world.isInWater(p)) return;
        // Height of the world box of the body.
        _box.copy(this.data.bounds).applyMatrix4(_m.compose(p, this.rigid.angPosition, _one));
        const coverage = water.surfaceZ < _box.max.z ? (water.surfaceZ - _box.min.z) / (_box.max.z - _box.min.z) : 1;
        this.waterCoverage = THREE.MathUtils.clamp(coverage, 0, 1);
        if (this.waterCoverage >= 0.1) {
            this._drag = this.data.drag * water.viscosity * this.waterCoverage;
            this._buoyancy = (water.density / this.data.density) * this.waterCoverage;
        }
    }

    private _updateMove(move: VehicleMove): void {
        this.throttle = move.throttle;
        this.braking = move.brake;
        const max = this.data.maxSteeringAngle;
        // The shipped exe lets go of the wheel: no steering input means 10% back toward center per tick.
        if (move.yaw === 0) this.steering *= STEERING_RETURN;
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
                const g = GRAVITY * this._world.gravityMod * dt;
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
            w.rawExtension = 1;
            w.contact = false;
            // The exe resets this every step, so tires always use static friction.
            w.slipping = false;
            // The ray starts above the mount, so the extension can go negative (exe).
            _v.copy(w.mount.position);
            _v.z += WHEEL_RAY_LIFT;
            const sp = _pos.copy(_v).applyQuaternion(r.angPosition).add(r.linPosition);
            const vec = _v.set(0, 0, -spring.length).applyQuaternion(r.angPosition);
            let ts = (tire.radius + WHEEL_RAY_LIFT) / spring.length;
            const ep = _end.copy(sp).addScaledVector(vec, 1 + ts);
            ts = ts / (1 + ts);
            const hit = this._world.castRay(sp, ep);
            if (hit) {
                w.contact = true;
                w.rawExtension = (hit.t - ts) / (1 - ts);
                w.extension = hit.t < ts ? 0 : w.rawExtension;
                w.contactNormal.copy(hit.normal);
                w.contactPoint.copy(hit.point);
            }
        }
    }

    private _updateForces(dt: number): void {
        this.extendWheels();
        const r = this.rigid;
        const gravity = GRAVITY * this._world.gravityMod;

        // Fell out of the world.
        if (!this._fallen && r.linPosition.z < 0) {
            this._fallen = true;
            this.onStuck?.();
            return;
        }
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

        // Stuck: no momentum at all, or pressing the throttle without getting anywhere.
        if (r.linMomentum.lengthSq() === 0 || (this.throttle !== 0 && r.linVelocity.length() < STUCK_SPEED)) {
            if (this._stuckSteps++ > STUCK_STEPS) {
                this._stuckSteps = 0;
                this.onStuck?.();
                return;
            }
        } else {
            this._stuckSteps = 0;
        }

        r.force.set(0, 0, 0);
        r.torque.set(0, 0, 0);
        let contacts = 0;

        for (const w of this.wheels) {
            const { tire, spring } = w.mount;
            let Fy = 0;
            if (w.contact) {
                _pos.copy(w.mount.position).applyQuaternion(r.angPosition).add(r.linPosition);
                r.getOriginVector(_pos, _r);
                const localVel = r.getVelocity(_r, new THREE.Vector3());

                contacts++;
                // Pressed past full compression, the spring pushes harder, up to ten times (exe).
                if (w.rawExtension < 0) w.rawExtension *= 2;
                const springForce = spring.force * THREE.MathUtils.clamp(1 - w.rawExtension, 0, MAX_SPRING_SCALE);

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
                const ddy =
                    (w.avel * tire.radius - yVelocity - tire.longitudinalRelaxation * Math.abs(w.avel) * w.Dy) *
                    TIRE_RATE_SCALE;
                w.Dy = THREE.MathUtils.clamp(w.Dy + ddy * dt, -MAX_TIRE_DEFORMATION, MAX_TIRE_DEFORMATION);
                Fy = clampForce(tire.longitudinalForce * w.Dy + tire.longitudinalDamping * ddy);

                // Lateral tire deformation.
                const ddx = (xVelocity - tire.lateralRelaxation * Math.abs(w.avel) * w.Dx) * TIRE_RATE_SCALE;
                w.Dx = THREE.MathUtils.clamp(w.Dx + ddx * dt, -MAX_TIRE_DEFORMATION, MAX_TIRE_DEFORMATION);
                let Fx = clampForce(-(tire.lateralForce * w.Dx + tire.lateralDamping * ddx));

                const verticalLoad = THREE.MathUtils.clamp(springForce + damping + antiSway, 0, MAX_FORCE);

                // Friction circle, with the grip of the ground under it (ice zones).
                const mu = this.surfaceFriction * (w.slipping ? tire.kineticFriction : tire.staticFriction);
                let Fn = verticalLoad * mu;
                Fn *= Fn;
                const Fw = Fx * Fx + Fy * Fy;
                if (Fw > SANE_FORCE_SQ || Fn > SANE_FORCE_SQ) {
                    Fy = 0;
                    w.Dy = 0;
                    w.Dx = 0;
                }
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

        // Container drag and buoyancy (water).
        r.force.z += -this._buoyancy * gravity * r.mass;
        r.force.addScaledVector(r.linVelocity, -this._drag);
        r.torque.addScaledVector(r.angMomentum, -this._drag);

        // The exe adds gravity before the wake-up test, so the body always wakes.
        r.force.z += gravity * r.mass;
        if (r.atRest && (r.force.lengthSq() > 0 || r.torque.lengthSq() > 0)) r.atRest = false;

        // Self-righting: turn the body's up axis toward world up when it tilts (exe).
        if (_bz.z < RIGHTING_TILT) {
            r.angMomentum.x += RIGHTING_TORQUE * (_bx.z * _by.x - _by.z * _bx.x);
            r.angMomentum.y += RIGHTING_TORQUE * (_bx.z * _by.y - _by.z * _bx.y);
        }
        // Upside down for a while: kick it over (exe).
        if (_bz.z < FLIP_TILT) {
            if (this._flipSteps++ > FLIP_STEPS) {
                const n = this._flipSteps;
                r.angMomentum
                    .copy(_bx)
                    .multiplyScalar(n + 500)
                    .addScaledVector(_by, n + 1000);
            }
        } else {
            this._flipSteps = 0;
        }
        // autoAlignForce: damp sideways and body-vertical motion while on the ground (exe).
        if (data.autoAlignForce > 0 && contacts > 1) {
            const v = r.linVelocity;
            const k = AUTO_ALIGN_SCALE * data.autoAlignForce;
            r.force.addScaledVector(_bx, -k * _bx.dot(v)).addScaledVector(_bz, -k * _bz.dot(v));
        }

        // Physical zones push too (exe; stock wheeled vehicles ignore them).
        r.force.add(this.appliedForce);
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
        this._world.findContacts(this._hullWorld, r.worldCenterOfMass, this.data.collisionTol, this._contacts, this);
        const collided = resolveCollisions(r, this._contacts, this.data.collisionTol);
        resolveContacts(r, this._contacts, this.data.collisionTol, this.data.contactTol, dt);
        return collided;
    }
}

/** Limit on tire and load forces (exe). */
const MAX_FORCE = 1e6;
/** Squared force above which the tire state is reset as broken (exe). */
const SANE_FORCE_SQ = 1e10;

function clampForce(f: number): number {
    return THREE.MathUtils.clamp(f, -MAX_FORCE, MAX_FORCE);
}
