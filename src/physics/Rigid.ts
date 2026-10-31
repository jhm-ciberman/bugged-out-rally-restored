import * as THREE from 'three';

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix3();
const _q = new THREE.Quaternion();
/** Impulse factor of `Rigid::resolveCollision` in the exe (stock: 1 + restitution). */
const EXE_BOUNCE = 1.1;
/** Friction cap of `Rigid::resolveCollision` in the exe (stock: the body's friction). */
const EXE_FRICTION = 0.3;

/**
 * A rigid body integrated the way Torque's `Rigid` class does it (`game/rigid.cc`).
 *
 * All vectors are in world space (Z up). Momentum is the integrated state, velocities are derived from it.
 */
export class Rigid {
    /** Force accumulated for the current step. */
    readonly force = new THREE.Vector3();
    /** Torque accumulated for the current step. */
    readonly torque = new THREE.Vector3();

    readonly linVelocity = new THREE.Vector3();
    /** Position of the body origin. */
    readonly linPosition = new THREE.Vector3();
    readonly linMomentum = new THREE.Vector3();
    readonly angVelocity = new THREE.Vector3();
    /** Rotation from body space to world space. */
    readonly angPosition = new THREE.Quaternion();
    readonly angMomentum = new THREE.Vector3();

    readonly invObjectInertia = new THREE.Matrix3();
    readonly invWorldInertia = new THREE.Matrix3();

    /** Center of mass in body space. */
    readonly centerOfMass = new THREE.Vector3();
    /** Center of mass in world space. */
    readonly worldCenterOfMass = new THREE.Vector3();

    mass = 1;
    oneOverMass = 1;
    restitution = 0.3;
    friction = 0.5;
    atRest = false;

    /**
     * Sets the mass, keeping {@link oneOverMass} in sync.
     */
    setMass(mass: number): void {
        this.mass = mass;
        this.oneOverMass = 1 / mass;
    }

    clearForces(): void {
        this.force.set(0, 0, 0);
        this.torque.set(0, 0, 0);
    }

    /**
     * Advances position and momentum by `dt` seconds using the accumulated force and torque.
     */
    integrate(dt: number): void {
        const angle = this.angVelocity.length();
        if (angle !== 0) {
            // Rotate about the world-space angular velocity axis, around the center of mass.
            _q.setFromAxisAngle(_v.copy(this.angVelocity).divideScalar(angle), angle * dt);
            this.angPosition.premultiply(_q).normalize();
            _v.copy(this.linPosition).sub(this.worldCenterOfMass).applyQuaternion(_q);
            this.linPosition.copy(_v).add(this.worldCenterOfMass);
        }

        this.angMomentum.addScaledVector(this.torque, dt);

        this.linPosition.addScaledVector(this.linVelocity, dt);
        this.linMomentum.addScaledVector(this.force, dt);
        this.linVelocity.copy(this.linMomentum).multiplyScalar(this.oneOverMass);

        this.updateInertialTensor();
        this.updateVelocity();
        this.updateCenterOfMass();
    }

    updateVelocity(): void {
        this.linVelocity.copy(this.linMomentum).multiplyScalar(this.oneOverMass);
        this.angVelocity.copy(this.angMomentum).applyMatrix3(this.invWorldInertia);
    }

    updateInertialTensor(): void {
        // R * I^-1 * R^T
        const r = _m.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(this.angPosition));
        this.invWorldInertia.multiplyMatrices(r, this.invObjectInertia);
        this.invWorldInertia.multiply(r.transpose());
    }

    updateCenterOfMass(): void {
        this.worldCenterOfMass.copy(this.centerOfMass).applyQuaternion(this.angPosition).add(this.linPosition);
    }

    /**
     * Applies an impulse at `r`, a vector from the center of mass.
     */
    applyImpulse(r: THREE.Vector3, impulse: THREE.Vector3): void {
        this.atRest = false;
        this.linMomentum.add(impulse);
        this.linVelocity.copy(this.linMomentum).multiplyScalar(this.oneOverMass);
        this.angMomentum.add(_a.crossVectors(r, impulse));
        this.angVelocity.copy(this.angMomentum).applyMatrix3(this.invWorldInertia);
    }

    /**
     * Pushes the body away from an immovable surface touched at world point `p`, with friction.
     *
     * Does nothing when the point is already separating. Returns whether an impulse was applied.
     */
    resolveCollision(p: THREE.Vector3, normal: THREE.Vector3): boolean {
        this.atRest = false;
        const r = this.getOriginVector(p, new THREE.Vector3());
        const v = this.getVelocity(r, new THREE.Vector3());
        const n = -v.dot(normal);
        if (n < 0) return false;

        // The shipped exe uses fixed constants here instead of the body's restitution and friction.
        let j = n * EXE_BOUNCE * this.getZeroImpulse(r, normal);
        const impulse = normal.clone().multiplyScalar(j);

        // Friction impulse: enough to stop the motion along the surface, capped by Coulomb friction.
        const uv = v.addScaledVector(normal, n);
        const ul = uv.length();
        if (ul) {
            uv.divideScalar(-ul);
            let u = ul * this.getZeroImpulse(r, uv);
            j *= EXE_FRICTION;
            if (u > j) u = j;
            impulse.addScaledVector(uv, u);
        }
        this.applyImpulse(r, impulse);
        return true;
    }

    /**
     * Returns the impulse needed per unit of velocity change along `normal` at `r`.
     */
    getZeroImpulse(r: THREE.Vector3, normal: THREE.Vector3): number {
        _a.crossVectors(r, normal).applyMatrix3(this.invWorldInertia);
        _b.crossVectors(_a, r);
        return 1 / (this.oneOverMass + _b.dot(normal));
    }

    getKineticEnergy(): number {
        // Angular velocity in body space, with the diagonal inverse inertia.
        const w = _v.copy(this.angVelocity).applyQuaternion(_q.copy(this.angPosition).invert());
        const f = this.invObjectInertia.elements;
        return (
            0.5 *
            (this.mass * this.linVelocity.dot(this.linVelocity) +
                (w.x * w.x) / f[0] +
                (w.y * w.y) / f[4] +
                (w.z * w.z) / f[8])
        );
    }

    /**
     * Writes the vector from the center of mass to world point `p` into `out`.
     */
    getOriginVector(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
        return out.copy(p).sub(this.worldCenterOfMass);
    }

    /**
     * Writes the world velocity of the point at `r` (from the center of mass) into `out`.
     */
    getVelocity(r: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
        return out.crossVectors(this.angVelocity, r).add(this.linVelocity);
    }

    setCenterOfMass(center: THREE.Vector3): void {
        this.centerOfMass.copy(center);
        this.updateCenterOfMass();
    }

    /**
     * Places the body. Leaves its momentum untouched.
     */
    setTransform(position: THREE.Vector3, rotation: THREE.Quaternion): void {
        this.linPosition.copy(position);
        this.angPosition.copy(rotation);
        this.updateCenterOfMass();
        this.updateInertialTensor();
    }

    /**
     * Sets the moment of inertia of a solid box with the given dimensions.
     */
    setObjectInertiaBox(size: THREE.Vector3): void {
        const ot = this.mass / 12;
        const a = size.x * size.x;
        const b = size.y * size.y;
        const c = size.z * size.z;
        this.invObjectInertia.set(1 / (ot * (b + c)), 0, 0, 0, 1 / (ot * (c + a)), 0, 0, 0, 1 / (ot * (a + b)));
        this.updateInertialTensor();
    }

    setAtRest(): void {
        this.atRest = true;
        this.linVelocity.set(0, 0, 0);
        this.linMomentum.set(0, 0, 0);
        this.angVelocity.set(0, 0, 0);
        this.angMomentum.set(0, 0, 0);
    }
}
