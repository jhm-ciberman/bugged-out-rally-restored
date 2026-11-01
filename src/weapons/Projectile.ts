import * as THREE from 'three';
import type { Car } from '../game/Car';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { type ExplosionData, ROCKET_EXPLOSION, ROCKET_WATER_EXPLOSION, SPIT_EXPLOSION } from './Explosions';

/** Projectiles step on the 32 ms game tick. */
export const PROJECTILE_TICK = 0.032;
/** Gravity per tick for ballistic projectiles (9.81 x 0.032). */
const GRAVITY_PER_TICK = 0.31392;
/** Ticks before guidance starts. */
const GUIDANCE_DELAY_TICKS = 3;
/** Cosine of the half-angle of the homing cone (non-magnetic projectiles). */
const GUIDANCE_CONE = 0.7;
const GUIDANCE_MIN_DISTANCE = 1;
const GUIDANCE_MAX_DISTANCE = 1000;
/** Reach of a magnetic projectile. */
const MAGNETIC_RANGE = 50;
/** Ticks after which an untargeted magnetic projectile stops in place. */
const MAGNETIC_PARK_TICKS = 5;

/**
 * A projectile datablock (`ProjectileData`), with the custom flags of the shipped exe.
 */
export interface ProjectileData {
    readonly shapeFile: string;
    readonly muzzleVelocity: number;
    /** Lifetime in 32 ms ticks. */
    readonly lifetimeTicks: number;
    readonly gravityMod: number;
    /** Gravity only applies to ballistic projectiles. */
    readonly isBallistic: boolean;
    readonly oscillate: boolean;
    readonly selfGuidance: boolean;
    readonly magnetic: boolean;
    readonly damage: number;
    /** What it does when it hits something (`Explosion`). */
    readonly explosion: ExplosionData;
    /** What it does when it goes off under water (`waterExplosion`); without one it uses `explosion`. */
    readonly waterExplosion?: ExplosionData;
    /** Whether it glows as it flies (`hasLight`). */
    readonly hasLight: boolean;
}

/** The Zinger rocket (`RocketProjectile` in weapons.cs). */
export const ROCKET: ProjectileData = {
    shapeFile: '~/data/shapes/rocket/zingerammo.dts',
    muzzleVelocity: 150,
    lifetimeTicks: Math.round(5000 / 32),
    gravityMod: 0.5,
    isBallistic: false,
    oscillate: true,
    selfGuidance: true,
    magnetic: false,
    damage: 40,
    explosion: ROCKET_EXPLOSION,
    waterExplosion: ROCKET_WATER_EXPLOSION,
    hasLight: true,
};

/** The Magno bomb (`MagneticBombProjectile` in weapons.cs). */
export const BOMB: ProjectileData = {
    shapeFile: '~/data/shapes/items/bomb.dts',
    muzzleVelocity: 60,
    lifetimeTicks: Math.round(30000 / 32),
    gravityMod: 0,
    isBallistic: false,
    oscillate: true,
    selfGuidance: true,
    magnetic: true,
    damage: 40,
    explosion: ROCKET_EXPLOSION,
    waterExplosion: ROCKET_WATER_EXPLOSION,
    hasLight: true,
};

/** Frog spit (`SpitProjectile` in dynShape.cs). */
export const SPIT: ProjectileData = {
    shapeFile: '~/data/shapes/items/spitz.dts',
    muzzleVelocity: 80,
    lifetimeTicks: Math.round(2000 / 32),
    gravityMod: 0.8,
    isBallistic: true,
    oscillate: true,
    selfGuidance: true,
    magnetic: false,
    damage: 25,
    explosion: SPIT_EXPLOSION,
    hasLight: false,
};

const _end = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _local = new THREE.Ray();
const _inv = new THREE.Matrix4();
const _box = new THREE.Box3();
const _hit = new THREE.Vector3();

/**
 * What a projectile ran into this tick.
 */
export interface ProjectileHit {
    readonly point: THREE.Vector3;
    /** The car it hit, or `null` for the ground or a building. */
    readonly car: Car | null;
}

/**
 * A flying projectile, simulated like the shipped exe's `Projectile::processTick` (0x507d60):
 * snap-to-target homing, a corkscrew wobble, and magnetic mines that wait in place.
 */
export class Projectile {
    readonly position: THREE.Vector3;
    readonly velocity: THREE.Vector3;
    age = 0;
    private readonly _launchZ: number;
    private _phase = 0;

    constructor(
        readonly data: ProjectileData,
        /** The car that fired it, which it never hits or chases. */
        readonly shooter: Car | null,
        position: THREE.Vector3,
        velocity: THREE.Vector3,
    ) {
        this.position = position.clone();
        this.velocity = velocity.clone();
        this._launchZ = position.z;
    }

    /** Whether the projectile has run out of time. */
    get expired(): boolean {
        return this.age >= this.data.lifetimeTicks;
    }

    /**
     * Advances one tick. Returns what it hit, or `null` while still flying.
     */
    tick(world: CollisionWorld, cars: readonly Car[]): ProjectileHit | null {
        this.age++;
        const d = this.data;

        if (d.selfGuidance && this.age >= GUIDANCE_DELAY_TICKS) {
            const target = this._findTarget(cars);
            if (target) {
                this.velocity
                    .subVectors(target.vehicle.rigid.worldCenterOfMass, this.position)
                    .setLength(d.muzzleVelocity);
            } else if (d.magnetic && this.age > MAGNETIC_PARK_TICKS) {
                this.velocity.set(0, 0, 0);
            }
        }
        if (d.isBallistic) this.velocity.z -= d.gravityMod * GRAVITY_PER_TICK;

        _end.copy(this.position).addScaledVector(this.velocity, PROJECTILE_TICK);
        if (d.oscillate) {
            if (d.magnetic) {
                if (Math.abs(this.position.z - this._launchZ) > MAGNETIC_RANGE) this._phase = 0;
                _end.z += 0.25 * Math.cos(this._phase);
                this._phase += 0.2;
            } else {
                // The push runs along the world diagonal, not across the flight path.
                const theta = 1.15 * this.age;
                _end.x += 0.5 * Math.sin(theta);
                _end.y += 0.5 * Math.sin(theta);
                _end.z += 0.5 * Math.cos(theta);
            }
        }

        const hit = this._sweep(world, cars);
        this.position.copy(_end);
        return hit;
    }

    private _findTarget(cars: readonly Car[]): Car | null {
        let best: Car | null = null;
        let bestScore = Number.NEGATIVE_INFINITY;
        const speed = this.velocity.length();
        if (speed > 0) _dir.copy(this.velocity).divideScalar(speed);
        for (const car of cars) {
            if (car === this.shooter || car.respawnTimer > 0) continue;
            _to.subVectors(car.vehicle.rigid.worldCenterOfMass, this.position);
            const distance = _to.length();
            if (this.data.magnetic) {
                // Nearest car in reach, any direction.
                if (distance <= MAGNETIC_RANGE && -distance > bestScore) {
                    best = car;
                    bestScore = -distance;
                }
                continue;
            }
            if (distance < GUIDANCE_MIN_DISTANCE || distance > GUIDANCE_MAX_DISTANCE || speed === 0) continue;
            // Best lined up inside the cone.
            const alignment = _dir.dot(_to.divideScalar(distance));
            if (alignment >= GUIDANCE_CONE && alignment > bestScore) {
                best = car;
                bestScore = alignment;
            }
        }
        return best;
    }

    private _sweep(world: CollisionWorld, cars: readonly Car[]): ProjectileHit | null {
        let bestT = Number.POSITIVE_INFINITY;
        let result: ProjectileHit | null = null;
        const length = this.position.distanceTo(_end);
        if (length === 0) return null;

        const wall = world.castRay(this.position, _end);
        if (wall) {
            bestT = wall.t * length;
            result = { point: wall.point, car: null };
        }

        for (const car of cars) {
            if (car === this.shooter || car.respawnTimer > 0) continue;
            const rigid = car.vehicle.rigid;
            _inv.compose(rigid.linPosition, rigid.angPosition, new THREE.Vector3(1, 1, 1)).invert();
            _local.origin.copy(this.position).applyMatrix4(_inv);
            _local.direction.copy(_end).applyMatrix4(_inv).sub(_local.origin).normalize();
            _box.copy(car.vehicle.data.bounds);
            if (_local.intersectBox(_box, _hit)) {
                const t = _hit.distanceTo(_local.origin);
                if (t <= length && t < bestT) {
                    bestT = t;
                    result = {
                        point: this.position.clone().lerp(_end, t / length),
                        car,
                    };
                }
            }
        }
        return result;
    }
}
