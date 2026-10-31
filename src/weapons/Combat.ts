import * as THREE from 'three';
import type { ModelLibrary } from '../assets/ModelLibrary';
import type { AudioSystem } from '../audio/AudioSystem';
import type { Car } from '../game/Car';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { EXPLOSION_FIRE, EXPLOSION_SMOKE, EXPLOSION_SPARKS, Particles, ROCKET_EXHAUST } from '../render/Particles';
import { BOMB, Projectile, type ProjectileData, ROCKET } from './Projectile';
import { WeaponImage } from './WeaponImage';

/** Extra upward speed given to a Zinger at launch (`RocketLauncherImage::onFire`). */
const ROCKET_LIFT = 5;
/** Height above the mount where a Magno bomb appears (`BombLauncherImage::onFire`). */
const BOMB_DROP_HEIGHT = 2;
/** Seconds between exhaust puffs behind a Zinger (`RocketExhaustParticleEmitter.ejectionPeriodMS`). */
const EXHAUST_PERIOD = 0.005;
/** Speed of a new exhaust puff (`ejectionVelocity`). */
const EXHAUST_SPEED = 0.1;
/** Glow of a flying projectile (`hasLight`, `lightRadius`, `lightColor`). */
const PROJECTILE_LIGHT = { radius: 5, color: new THREE.Color(0.5, 0.5, 0.25) };
/** Explosion flash (`RocketExplosion`: light radius 6 to 3, color 0.5 0.5 0 to black, over its 1.2 s life). */
const EXPLOSION_LIGHT = { seconds: 1.2, startRadius: 6, endRadius: 3, color: new THREE.Color(0.5, 0.5, 0) };
/** Camera shake of an explosion (`camShakeAmp`, `camShakeFreq`, `camShakeDuration`, `camShakeRadius`). */
const SHAKE = { amplitude: 1, frequency: new THREE.Vector3(10, 11, 10), seconds: 0.5, radius: 10 };
/** Lights kept in the scene. A fixed count, so adding one never makes every material recompile. */
const LIGHT_POOL = 6;

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
    /** Position at the start of the current tick, for drawing between ticks. */
    readonly previous: THREE.Vector3;
    model: THREE.Object3D | null;
    light: THREE.PointLight | null;
}

interface Flash {
    readonly light: THREE.PointLight;
    age: number;
}

interface Shake {
    readonly center: THREE.Vector3;
    age: number;
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
    private readonly _freeLights: THREE.PointLight[] = [];
    private readonly _flashes: Flash[] = [];
    private readonly _shakes: Shake[] = [];
    private _time = 0;

    /** The model loader projectiles use. */
    get models(): ModelLibrary {
        return this._models;
    }

    /** The sound system projectiles play through, if any. */
    get audio(): AudioSystem | null {
        return this._audio;
    }

    constructor(
        private readonly _world: CollisionWorld,
        private readonly _models: ModelLibrary,
        private readonly _audio: AudioSystem | null,
    ) {
        this.object.add(this.particles.object);
        for (let i = 0; i < LIGHT_POOL; i++) {
            const light = new THREE.PointLight(0xffffff, 0, 1, 1);
            this.object.add(light);
            this._freeLights.push(light);
        }
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
            f.previous.copy(f.projectile.position);
            const hit = f.projectile.tick(this._world, cars);
            if (f.projectile.data === ROCKET) this._exhaust(f.previous, f.projectile.position, dt);
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
     * Updates the drawn projectiles, particles and flashes.
     *
     * @param alpha How far the frame is between the previous tick and the current one (0 to 1).
     */
    update(dt: number, alpha: number): void {
        this._time += dt;
        for (const f of this._flying) {
            const at = new THREE.Vector3().lerpVectors(f.previous, f.projectile.position, alpha);
            f.light?.position.copy(at);
            if (!f.model) continue;
            f.model.position.copy(at);
            const v = f.projectile.velocity;
            if (v.lengthSq() > 1e-6) {
                f.model.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
            }
        }
        for (let i = this._flashes.length - 1; i >= 0; i--) {
            const flash = this._flashes[i];
            flash.age += dt;
            const t = flash.age / EXPLOSION_LIGHT.seconds;
            if (t >= 1) {
                this._releaseLight(flash.light);
                this._flashes.splice(i, 1);
                continue;
            }
            flash.light.distance =
                EXPLOSION_LIGHT.startRadius + (EXPLOSION_LIGHT.endRadius - EXPLOSION_LIGHT.startRadius) * t;
            flash.light.color.copy(EXPLOSION_LIGHT.color).multiplyScalar(1 - t);
        }
        for (let i = this._shakes.length - 1; i >= 0; i--) {
            this._shakes[i].age += dt;
            if (this._shakes[i].age >= SHAKE.seconds) this._shakes.splice(i, 1);
        }
        this.particles.update(dt);
    }

    /**
     * Returns how far explosions shake a camera at `position` right now (`camShake*` of the explosion).
     */
    cameraShake(position: THREE.Vector3): THREE.Vector3 {
        const offset = new THREE.Vector3();
        for (const s of this._shakes) {
            const distance = s.center.distanceTo(position);
            if (distance > SHAKE.radius) continue;
            // Fades out over the shake's life and with distance from the blast.
            const fade = (1 - s.age / SHAKE.seconds) * (1 - distance / SHAKE.radius) * SHAKE.amplitude;
            const t = this._time * Math.PI * 2;
            offset.x += Math.sin(t * SHAKE.frequency.x) * fade;
            offset.y += Math.sin(t * SHAKE.frequency.y + 1) * fade;
            offset.z += Math.sin(t * SHAKE.frequency.z + 2) * fade;
        }
        return offset;
    }

    /**
     * Removes every projectile and particle.
     */
    dispose(): void {
        for (let i = this._flying.length - 1; i >= 0; i--) this._remove(i);
        this.particles.dispose();
        this.object.removeFromParent();
    }

    private _fire(car: Car, data: ProjectileData, mount: 0 | 1): void {
        const rigid = car.vehicle.rigid;
        const muzzle = car.vehicle.data.mounts[mount].clone().applyQuaternion(rigid.angPosition).add(rigid.linPosition);
        const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(rigid.angPosition);
        // Speed = shooter speed + muzzle velocity, all along the muzzle direction.
        const velocity = forward.multiplyScalar(rigid.linVelocity.length() + data.muzzleVelocity);
        if (data === ROCKET) velocity.z += ROCKET_LIFT;
        else muzzle.z += BOMB_DROP_HEIGHT;

        this.launch(data, car, muzzle, velocity);
        if (this._audio) {
            void this._audio.play3d(data === ROCKET ? 'RocketFireSound' : 'BombFireSound', muzzle, this.object);
        }
    }

    /**
     * Starts a projectile at `position` with `velocity`. `shooter` is never hit or chased by it.
     */
    launch(data: ProjectileData, shooter: Car | null, position: THREE.Vector3, velocity: THREE.Vector3): void {
        const projectile = new Projectile(data, shooter, position, velocity);
        const light = data.hasLight ? this._takeLight() : null;
        if (light) {
            light.color.copy(PROJECTILE_LIGHT.color);
            light.distance = PROJECTILE_LIGHT.radius;
            light.position.copy(position);
        }
        const flying: Flying = { projectile, previous: position.clone(), model: null, light };
        this._flying.push(flying);
        void this._models.instantiate(data.shapeFile).then((model) => {
            if (!model || !this._flying.includes(flying)) return;
            flying.model = model;
            model.position.copy(projectile.position);
            this.object.add(model);
        });
    }

    /**
     * Leaves a puff every 5 ms along the path flown this tick.
     */
    private _exhaust(from: THREE.Vector3, to: THREE.Vector3, dt: number): void {
        const count = Math.round(dt / EXHAUST_PERIOD);
        const p = new THREE.Vector3();
        const v = new THREE.Vector3();
        for (let i = 0; i < count; i++) {
            p.lerpVectors(from, to, (i + 1) / count);
            v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).setLength(
                EXHAUST_SPEED * Math.random() * 2,
            );
            this.particles.emit(ROCKET_EXHAUST, p, v);
        }
    }

    /**
     * Plays an explosion (`RocketExplosion`): a ball of fire, smoke and sparks, a flash and a camera shake.
     */
    private _explode(projectile: Projectile, point: THREE.Vector3): void {
        // particleEmitter: 100 fire particles in a 2 m ball, ejected at 0.8 m/s.
        this.particles.burst(EXPLOSION_FIRE, point, 100, 0.8, 0.5, undefined, { radius: 2 });
        // emitter[0]: smoke every 10 ms for 250 ms at 4 m/s; emitter[1]: sparks every 2 ms for 150 ms at 30 m/s.
        this.particles.burst(EXPLOSION_SMOKE, point, 25, 4, 0.5);
        this.particles.burst(EXPLOSION_SPARKS, point, 75, 30, 10);
        const light = this._takeLight();
        if (light) {
            light.position.copy(point);
            this._flashes.push({ light, age: 0 });
        }
        this._shakes.push({ center: point.clone(), age: 0 });
        if (this._audio) void this._audio.play3d(projectile.data.explosionSound, point, this.object);
    }

    private _takeLight(): THREE.PointLight | null {
        const light = this._freeLights.pop() ?? null;
        if (light) light.intensity = Math.PI;
        return light;
    }

    private _releaseLight(light: THREE.PointLight): void {
        light.intensity = 0;
        this._freeLights.push(light);
    }

    private _remove(index: number): void {
        const [f] = this._flying.splice(index, 1);
        if (f.model) this.object.remove(f.model);
        if (f.light) this._releaseLight(f.light);
    }
}
