import * as THREE from 'three';
import type { ModelLibrary } from '../assets/ModelLibrary';
import type { AudioSystem } from '../audio/AudioSystem';
import type { Car } from '../game/Car';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { EXPLOSION_FIRE, EXPLOSION_SMOKE, EXPLOSION_SPARKS, Particles } from '../render/Particles';
import { BOMB, Projectile, type ProjectileData, ROCKET } from './Projectile';
import { WeaponImage } from './WeaponImage';

/** Extra upward speed given to a Zinger at launch (`RocketLauncherImage::onFire`). */
const ROCKET_LIFT = 5;
/** Height above the mount where a Magno bomb appears (`BombLauncherImage::onFire`). */
const BOMB_DROP_HEIGHT = 2;

/**
 * The fire buttons of one car for one tick: slot 1 fires Zingers, slot 2 drops Magno bombs.
 */
export interface Triggers {
    fire: boolean;
    drop: boolean;
}

interface Armed {
    readonly rocket: WeaponImage;
    readonly bomb: WeaponImage;
}

interface Flying {
    readonly projectile: Projectile;
    model: THREE.Object3D | null;
}

/**
 * Something hit a car.
 */
export interface DamageEvent {
    readonly target: Car;
    readonly source: Car | null;
    readonly amount: number;
}

/**
 * Weapons, projectiles and explosions for every car in a race (`weapons.cs`).
 */
export class Combat {
    readonly object = new THREE.Group();
    readonly particles = new Particles();
    onDamage: ((event: DamageEvent) => void) | null = null;
    private readonly _armed = new Map<Car, Armed>();
    private readonly _flying: Flying[] = [];

    constructor(
        private readonly _world: CollisionWorld,
        private readonly _models: ModelLibrary,
        private readonly _audio: AudioSystem | null,
    ) {
        this.object.add(this.particles.object);
        for (const p of ['RocketFireSound', 'BombFireSound', 'RocketExplosionSound']) _audio?.preload(p);
    }

    /**
     * Steps every car's weapons and every projectile by one 32 ms tick.
     */
    tick(dt: number, cars: readonly Car[], triggers: ReadonlyMap<Car, Triggers>): void {
        for (const car of cars) {
            let armed = this._armed.get(car);
            if (!armed) {
                armed = { rocket: new WeaponImage(), bomb: new WeaponImage() };
                this._armed.set(car, armed);
            }
            const t = triggers.get(car);
            const alive = car.respawnTimer <= 0;
            if (armed.rocket.tick(dt, alive && !!t?.fire, car.rockets > 0)) {
                car.rockets--;
                this._fire(car, ROCKET, 0);
            }
            if (armed.bomb.tick(dt, alive && !!t?.drop, car.bombs > 0)) {
                car.bombs--;
                this._fire(car, BOMB, 1);
            }
        }

        for (let i = this._flying.length - 1; i >= 0; i--) {
            const f = this._flying[i];
            const hit = f.projectile.tick(this._world, cars);
            if (hit) {
                this._explode(f.projectile, hit.point);
                if (hit.car)
                    this.onDamage?.({
                        target: hit.car,
                        source: f.projectile.shooter,
                        amount: f.projectile.data.damage,
                    });
                this._remove(i);
            } else if (f.projectile.expired) {
                // Magnetic bombs blow up when their time runs out; the others just vanish.
                if (f.projectile.data.magnetic) this._explode(f.projectile, f.projectile.position);
                this._remove(i);
            }
        }
    }

    /**
     * Updates the drawn projectiles and particles.
     */
    update(dt: number): void {
        for (const f of this._flying) {
            if (!f.model) continue;
            f.model.position.copy(f.projectile.position);
            const v = f.projectile.velocity;
            if (v.lengthSq() > 1e-6)
                f.model.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
        }
        this.particles.update(dt);
    }

    private _fire(car: Car, data: ProjectileData, mount: 0 | 1): void {
        const rigid = car.vehicle.rigid;
        const muzzle = car.vehicle.data.mounts[mount].clone().applyQuaternion(rigid.angPosition).add(rigid.linPosition);
        const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(rigid.angPosition);
        // Speed = shooter speed + muzzle velocity, all along the muzzle direction.
        const velocity = forward.multiplyScalar(rigid.linVelocity.length() + data.muzzleVelocity);
        if (data === ROCKET) velocity.z += ROCKET_LIFT;
        else muzzle.z += BOMB_DROP_HEIGHT;

        const projectile = new Projectile(data, car, muzzle, velocity);
        const flying: Flying = { projectile, model: null };
        this._flying.push(flying);
        void this._models.instantiate(data.shapeFile).then((model) => {
            if (!model || !this._flying.includes(flying)) return;
            flying.model = model;
            model.position.copy(projectile.position);
            this.object.add(model);
        });
        if (this._audio) {
            void this._audio.play3d(data === ROCKET ? 'RocketFireSound' : 'BombFireSound', muzzle, this.object);
        }
    }

    private _explode(projectile: Projectile, point: THREE.Vector3): void {
        this.particles.burst(EXPLOSION_FIRE, point, 20, 0.8);
        this.particles.burst(EXPLOSION_SMOKE, point, 12, 4);
        this.particles.burst(EXPLOSION_SPARKS, point, 20, 30, 10);
        if (this._audio) void this._audio.play3d(projectile.data.explosionSound, point, this.object);
    }

    private _remove(index: number): void {
        const [f] = this._flying.splice(index, 1);
        if (f.model) this.object.remove(f.model);
    }
}
