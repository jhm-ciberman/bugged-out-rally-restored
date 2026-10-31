import * as THREE from 'three';
import { resolveTorqueFile } from '../assets/AssetPaths';

/**
 * A particle type, after Torque's `ParticleData`: colors and sizes are keyed at `times` (0 to 1 of the life).
 */
export interface ParticleLook {
    readonly texture: string;
    readonly lifetime: number;
    readonly lifetimeVariance: number;
    readonly colors: readonly (readonly [number, number, number, number])[];
    readonly sizes: readonly number[];
    readonly times: readonly number[];
    /** Multiplier on gravity (negative rises). */
    readonly gravityCoefficient: number;
    readonly dragCoefficient: number;
    /** Normal blending when true, additive glow when false (`useInvAlpha`). */
    readonly useInvAlpha: boolean;
}

interface Particle {
    readonly sprite: THREE.Sprite;
    readonly look: ParticleLook;
    readonly velocity: THREE.Vector3;
    age: number;
    readonly life: number;
}

const GRAVITY = 9.81;
const loader = new THREE.TextureLoader();

/**
 * A simple pool of camera-facing particles for explosions, splashes and dust.
 */
export class Particles {
    readonly object = new THREE.Group();
    private readonly _particles: Particle[] = [];
    private readonly _materials = new Map<ParticleLook, THREE.SpriteMaterial>();

    /**
     * Throws `count` particles out of `position` in random directions at about `speed` m/s,
     * plus `inherit` (for example the velocity of what exploded).
     */
    burst(
        look: ParticleLook,
        position: THREE.Vector3,
        count: number,
        speed: number,
        speedVariance = speed * 0.5,
        inherit?: THREE.Vector3,
    ): void {
        const material = this._material(look);
        for (let i = 0; i < count; i++) {
            const sprite = new THREE.Sprite(material.clone());
            sprite.position.copy(position);
            const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            const v = dir.multiplyScalar(speed + (Math.random() * 2 - 1) * speedVariance);
            if (inherit) v.add(inherit);
            const life = Math.max(0.05, look.lifetime + (Math.random() * 2 - 1) * look.lifetimeVariance);
            this._particles.push({ sprite, look, velocity: v, age: 0, life });
            this.object.add(sprite);
        }
    }

    update(dt: number): void {
        for (let i = this._particles.length - 1; i >= 0; i--) {
            const p = this._particles[i];
            p.age += dt;
            const t = p.age / p.life;
            if (t >= 1) {
                this.object.remove(p.sprite);
                p.sprite.material.dispose();
                this._particles.splice(i, 1);
                continue;
            }
            p.velocity.z -= GRAVITY * p.look.gravityCoefficient * dt;
            p.velocity.multiplyScalar(Math.max(0, 1 - p.look.dragCoefficient * dt));
            p.sprite.position.addScaledVector(p.velocity, dt);
            const [r, g, b, a] = keyed(p.look.colors, p.look.times, t);
            p.sprite.material.color.setRGB(r, g, b);
            p.sprite.material.opacity = a;
            const size = keyed(
                p.look.sizes.map((s) => [s, 0, 0, 0] as const),
                p.look.times,
                t,
            )[0];
            p.sprite.scale.setScalar(size);
        }
    }

    private _material(look: ParticleLook): THREE.SpriteMaterial {
        let m = this._materials.get(look);
        if (!m) {
            const url = resolveTorqueFile(look.texture);
            const map = url ? loader.load(url) : null;
            if (map) map.colorSpace = THREE.NoColorSpace;
            m = new THREE.SpriteMaterial({
                map,
                transparent: true,
                depthWrite: false,
                blending: look.useInvAlpha ? THREE.NormalBlending : THREE.AdditiveBlending,
                fog: false,
            });
            this._materials.set(look, m);
        }
        return m;
    }
}

function keyed(
    values: readonly (readonly [number, number, number, number])[],
    times: readonly number[],
    t: number,
): [number, number, number, number] {
    const last = values.length - 1;
    for (let i = 0; i < last; i++) {
        const t0 = times[i] ?? i / last;
        const t1 = times[i + 1] ?? (i + 1) / last;
        if (t <= t1) {
            const k = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
            const a = values[i];
            const b = values[i + 1];
            return [
                a[0] + (b[0] - a[0]) * k,
                a[1] + (b[1] - a[1]) * k,
                a[2] + (b[2] - a[2]) * k,
                a[3] + (b[3] - a[3]) * k,
            ];
        }
    }
    const v = values[last];
    return [v[0], v[1], v[2], v[3]];
}

/** Fire of an explosion (`RocketExplosionFireParticle`-style, weapons.cs / deathcar.cs). */
export const EXPLOSION_FIRE: ParticleLook = {
    texture: '~/data/shapes/rocket/fire',
    lifetime: 1.2,
    lifetimeVariance: 0.3,
    colors: [
        [0.8, 0.4, 0, 0.8],
        [0.2, 0, 0, 0.8],
        [0, 0, 0, 0],
    ],
    sizes: [1.5, 0.9, 0.5],
    times: [0, 0.5, 1],
    gravityCoefficient: 0,
    dragCoefficient: 1,
    useInvAlpha: false,
};

/** Smoke of an explosion. */
export const EXPLOSION_SMOKE: ParticleLook = {
    texture: '~/data/shapes/rocket/smoke',
    lifetime: 1.2,
    lifetimeVariance: 0.3,
    colors: [
        [0.56, 0.36, 0.26, 1],
        [0.2, 0.2, 0.2, 1],
        [0, 0, 0, 0],
    ],
    sizes: [4, 2.5, 1],
    times: [0, 0.5, 1],
    gravityCoefficient: -0.03,
    dragCoefficient: 2,
    useInvAlpha: true,
};

/** Sparks of an explosion. */
export const EXPLOSION_SPARKS: ParticleLook = {
    texture: '~/data/shapes/rocket/spark',
    lifetime: 0.5,
    lifetimeVariance: 0.35,
    colors: [
        [1, 0, 0, 1],
        [1, 1, 0, 0.8],
        [1, 1, 1, 0.1],
    ],
    sizes: [0.2, 0.15, 0.5],
    times: [0, 0.5, 1],
    gravityCoefficient: 0,
    dragCoefficient: 1,
    useInvAlpha: false,
};
