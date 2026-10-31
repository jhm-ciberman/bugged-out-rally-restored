import * as THREE from 'three';
import { type CollisionWorld, type Contact, SphereObstacle } from './CollisionWorld';
import { Rigid } from './Rigid';
import { resolveCollisions, resolveContacts } from './RigidCollision';

/** Gravity of vehicle-based objects (`sVehicleGravity`). */
const GRAVITY = -20;
/** Collision tolerances, the vehicle defaults (`VehicleData`). */
const COLLISION_TOL = 0.1;
const CONTACT_TOL = 0.1;
/** Air drag, the vehicle default. */
const DRAG = 0.7;
/**
 * Surface friction. The vehicle default is 0, which would make a ball slide instead of roll;
 * the native class may set its own, so this is a guess.
 */
const FRICTION = 0.5;

/**
 * Settings of a rolling object (`DynamicShapeData` in dynShape.cs).
 */
export interface DynamicShapeData {
    readonly shapeFile: string;
    readonly mass: number;
    readonly restitution: number;
    readonly radius: number;
    /** Lifetime in 32 ms ticks (`lifetime = 300`; the unit is not certain). */
    readonly lifetimeTicks: number;
}

/** A rolling boulder (`BoulderData`). */
export const BOULDER: DynamicShapeData = {
    shapeFile: '~/data/shapes/items/boulder.dts',
    mass: 150,
    restitution: 1,
    radius: 2.5,
    lifetimeTicks: 300,
};

/** A rolling snowball (`SnowballData`). */
export const SNOWBALL: DynamicShapeData = { ...BOULDER, shapeFile: '~/data/shapes/items/snowball.dts' };

/**
 * A free rigid ball, like the exe's `DynamicShape` (a `Vehicle` subclass with no wheels):
 * gravity, drag and Torque's contact response, and solid to cars.
 */
export class DynamicShape {
    readonly rigid = new Rigid();
    readonly obstacle: SphereObstacle;
    age = 0;
    private readonly _hull: THREE.Vector3[];
    private readonly _hullWorld: THREE.Vector3[];
    private readonly _contacts: Contact[] = [];

    constructor(
        readonly data: DynamicShapeData,
        private readonly _world: CollisionWorld,
        position: THREE.Vector3,
        momentum: THREE.Vector3,
    ) {
        const r = this.rigid;
        r.setMass(data.mass);
        r.restitution = data.restitution;
        r.friction = FRICTION;
        r.setObjectInertiaBox(new THREE.Vector3(1, 1, 1).multiplyScalar(data.radius * 2));
        r.setTransform(position, new THREE.Quaternion());
        r.linMomentum.copy(momentum);
        r.updateVelocity();
        const points = new THREE.IcosahedronGeometry(data.radius, 1).getAttribute('position');
        this._hull = [];
        for (let i = 0; i < points.count; i++) {
            const p = new THREE.Vector3().fromBufferAttribute(points, i);
            if (!this._hull.some((h) => h.distanceToSquared(p) < 1e-6)) this._hull.push(p);
        }
        this._hullWorld = this._hull.map(() => new THREE.Vector3());
        this.obstacle = new SphereObstacle(this, data.radius);
        this.obstacle.center.copy(position);
    }

    /** Whether the shape has lived out its lifetime. */
    get expired(): boolean {
        return this.age >= this.data.lifetimeTicks;
    }

    /**
     * Runs one 32 ms tick.
     */
    tick(dt: number): void {
        this.age++;
        const r = this.rigid;
        r.force.set(0, 0, GRAVITY * r.mass).addScaledVector(r.linVelocity, -DRAG);
        r.torque.copy(r.angMomentum).multiplyScalar(-DRAG);
        r.linMomentum.addScaledVector(r.force, dt);
        r.angMomentum.addScaledVector(r.torque, dt);
        r.updateVelocity();
        r.clearForces();

        for (let i = 0; i < this._hull.length; i++) {
            this._hullWorld[i].copy(this._hull[i]).applyQuaternion(r.angPosition).add(r.linPosition);
        }
        this._contacts.length = 0;
        this._world.findContacts(this._hullWorld, r.worldCenterOfMass, COLLISION_TOL, this._contacts, this);
        resolveCollisions(r, this._contacts, COLLISION_TOL);
        resolveContacts(r, this._contacts, COLLISION_TOL, CONTACT_TOL, dt);
        r.integrate(dt);
        this.obstacle.center.copy(r.linPosition);
    }
}
