import * as THREE from 'three';
import { resolveTorqueFile } from '../assets/AssetPaths';

/**
 * A particle type, after Torque's `ParticleData`: colors and sizes are keyed at `times` (0 to 1 of the life).
 */
export interface ParticleLook {
    readonly texture: string;
    /** Seconds. */
    readonly lifetime: number;
    readonly lifetimeVariance: number;
    readonly colors: readonly (readonly [number, number, number, number])[];
    /** Width of the particle, in meters, at each key. */
    readonly sizes: readonly number[];
    readonly times: readonly number[];
    /** Multiplier on gravity (negative rises). */
    readonly gravityCoefficient: number;
    readonly dragCoefficient: number;
    /** Normal blending when true, additive glow when false (`useInvAlpha`). */
    readonly useInvAlpha: boolean;
}

/** Gravity on particles (`ParticleEngine` uses 9.81). */
const GRAVITY = 9.81;
const INITIAL_CAPACITY = 256;
const loader = new THREE.TextureLoader();

/**
 * All live particles of one look, drawn in a single call as camera-facing quads.
 */
class ParticleBatch {
    readonly mesh: THREE.Mesh;
    private _capacity = 0;
    private _count = 0;
    private _pos = new Float32Array(0);
    private _vel = new Float32Array(0);
    private _age = new Float32Array(0);
    private _life = new Float32Array(0);
    private readonly _geometry = new THREE.InstancedBufferGeometry();
    private _iPos!: THREE.InstancedBufferAttribute;
    private _iColor!: THREE.InstancedBufferAttribute;
    private _iSize!: THREE.InstancedBufferAttribute;

    constructor(readonly look: ParticleLook) {
        const quad = new THREE.PlaneGeometry(1, 1);
        this._geometry.index = quad.index;
        this._geometry.setAttribute('position', quad.getAttribute('position'));
        this._geometry.setAttribute('uv', quad.getAttribute('uv'));
        this._grow(INITIAL_CAPACITY);
        const url = resolveTorqueFile(look.texture);
        const map = url ? loader.load(url) : null;
        if (map) map.colorSpace = THREE.NoColorSpace;
        const material = new THREE.ShaderMaterial({
            uniforms: { map: { value: map } },
            transparent: true,
            depthWrite: false,
            blending: look.useInvAlpha ? THREE.NormalBlending : THREE.AdditiveBlending,
            vertexShader: /* glsl */ `
                attribute vec3 iPos;
                attribute vec4 iColor;
                attribute float iSize;
                varying vec2 vUv;
                varying vec4 vColor;
                void main() {
                    vUv = uv;
                    vColor = iColor;
                    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
                    mv.xy += position.xy * iSize;
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: /* glsl */ `
                uniform sampler2D map;
                varying vec2 vUv;
                varying vec4 vColor;
                void main() {
                    gl_FragColor = texture2D(map, vUv) * vColor;
                }
            `,
        });
        this.mesh = new THREE.Mesh(this._geometry, material);
        this.mesh.frustumCulled = false;
    }

    add(position: THREE.Vector3, velocity: THREE.Vector3): void {
        if (this._count === this._capacity) this._grow(this._capacity * 2);
        const i = this._count++;
        this._pos.set([position.x, position.y, position.z], i * 3);
        this._vel.set([velocity.x, velocity.y, velocity.z], i * 3);
        this._age[i] = 0;
        const look = this.look;
        this._life[i] = Math.max(0.05, look.lifetime + (Math.random() * 2 - 1) * look.lifetimeVariance);
    }

    get count(): number {
        return this._count;
    }

    update(dt: number): void {
        const look = this.look;
        const drag = Math.max(0, 1 - look.dragCoefficient * dt);
        const fall = GRAVITY * look.gravityCoefficient * dt;
        let n = 0;
        for (let i = 0; i < this._count; i++) {
            const age = this._age[i] + dt;
            if (age >= this._life[i]) continue;
            // Keep the live particles packed at the front.
            if (n !== i) {
                this._pos.copyWithin(n * 3, i * 3, i * 3 + 3);
                this._vel.copyWithin(n * 3, i * 3, i * 3 + 3);
                this._life[n] = this._life[i];
            }
            this._age[n] = age;
            const v = n * 3;
            this._vel[v + 2] -= fall;
            this._vel[v] *= drag;
            this._vel[v + 1] *= drag;
            this._vel[v + 2] *= drag;
            this._pos[v] += this._vel[v] * dt;
            this._pos[v + 1] += this._vel[v + 1] * dt;
            this._pos[v + 2] += this._vel[v + 2] * dt;
            const t = age / this._life[n];
            const [r, g, b, a] = keyed(look.colors, look.times, t);
            this._iColor.setXYZW(n, r, g, b, a);
            this._iSize.setX(n, keyedSize(look.sizes, look.times, t));
            n++;
        }
        this._count = n;
        (this._iPos.array as Float32Array).set(this._pos.subarray(0, n * 3));
        this._iPos.needsUpdate = true;
        this._iColor.needsUpdate = true;
        this._iSize.needsUpdate = true;
        this._geometry.instanceCount = n;
    }

    dispose(): void {
        this._geometry.dispose();
        const m = this.mesh.material as THREE.ShaderMaterial;
        (m.uniforms.map.value as THREE.Texture | null)?.dispose();
        m.dispose();
    }

    private _grow(capacity: number): void {
        const grow = (old: Float32Array<ArrayBuffer>, size: number): Float32Array<ArrayBuffer> => {
            const next = new Float32Array(size);
            next.set(old.subarray(0, Math.min(old.length, size)));
            return next;
        };
        this._pos = grow(this._pos, capacity * 3);
        this._vel = grow(this._vel, capacity * 3);
        this._age = grow(this._age, capacity);
        this._life = grow(this._life, capacity);
        this._capacity = capacity;
        this._iPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        this._iColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
        this._iSize = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
        for (const a of [this._iPos, this._iColor, this._iSize]) a.setUsage(THREE.DynamicDrawUsage);
        this._geometry.setAttribute('iPos', this._iPos);
        this._geometry.setAttribute('iColor', this._iColor);
        this._geometry.setAttribute('iSize', this._iSize);
    }
}

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Camera-facing particles for explosions, trails, splashes and dust, after Torque's particle engine.
 */
export class Particles {
    readonly object = new THREE.Group();
    private readonly _batches = new Map<ParticleLook, ParticleBatch>();

    /**
     * Adds one particle at `position` moving at `velocity`.
     */
    emit(look: ParticleLook, position: THREE.Vector3, velocity: THREE.Vector3): void {
        this._batch(look).add(position, velocity);
    }

    /**
     * Throws `count` particles out of `position` at about `speed` m/s.
     *
     * Directions are spread over the upper half sphere (the default 0-90 degree ejection cone of
     * `ParticleEmitterData`), unless `fullSphere`. `radius` scatters the start points in a ball, like
     * an explosion's `particleRadius`.
     */
    burst(
        look: ParticleLook,
        position: THREE.Vector3,
        count: number,
        speed: number,
        speedVariance = speed * 0.5,
        inherit?: THREE.Vector3,
        options: { radius?: number; fullSphere?: boolean } = {},
    ): void {
        const batch = this._batch(look);
        for (let i = 0; i < count; i++) {
            randomDirection(_v, options.fullSphere ?? false);
            _p.copy(position);
            if (options.radius)
                _p.addScaledVector(randomDirection(new THREE.Vector3(), true), Math.random() * options.radius);
            _v.multiplyScalar(speed + (Math.random() * 2 - 1) * speedVariance);
            if (inherit) _v.add(inherit);
            batch.add(_p, _v);
        }
    }

    /** Number of live particles. */
    get count(): number {
        let n = 0;
        for (const b of this._batches.values()) n += b.count;
        return n;
    }

    update(dt: number): void {
        for (const b of this._batches.values()) b.update(dt);
    }

    dispose(): void {
        for (const b of this._batches.values()) b.dispose();
        this._batches.clear();
        this.object.clear();
    }

    private _batch(look: ParticleLook): ParticleBatch {
        let b = this._batches.get(look);
        if (!b) {
            b = new ParticleBatch(look);
            this._batches.set(look, b);
            this.object.add(b.mesh);
        }
        return b;
    }
}

function randomDirection(out: THREE.Vector3, fullSphere: boolean): THREE.Vector3 {
    const z = fullSphere ? Math.random() * 2 - 1 : Math.random();
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    return out.set(r * Math.cos(a), r * Math.sin(a), z);
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

function keyedSize(sizes: readonly number[], times: readonly number[], t: number): number {
    const last = sizes.length - 1;
    for (let i = 0; i < last; i++) {
        const t0 = times[i] ?? i / last;
        const t1 = times[i + 1] ?? (i + 1) / last;
        if (t <= t1) return sizes[i] + (sizes[i + 1] - sizes[i]) * (t1 > t0 ? (t - t0) / (t1 - t0) : 0);
    }
    return sizes[last];
}

/** Fire of an explosion (`RocketExplosionFireParticle`; its drag field is misspelled in the script, so none). */
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
    dragCoefficient: 0,
    useInvAlpha: false,
};

/** Smoke of an explosion (`RocketExplosionSmokeParticle`; drag misspelled, so none). */
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
    gravityCoefficient: 0,
    dragCoefficient: 0,
    useInvAlpha: true,
};

/** Sparks of an explosion (`RocketExplosionSparksParticles`). */
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

/** The smoke trail behind a flying Zinger (`RocketExhaustParticle`). */
export const ROCKET_EXHAUST: ParticleLook = {
    texture: '~/data/shapes/rocket/smoke',
    lifetime: 2,
    lifetimeVariance: 0.25,
    colors: [
        [0.8, 0.3, 0, 1],
        [0.1, 0.1, 0.1, 0.7],
        [0.1, 0.1, 0.1, 0],
    ],
    sizes: [0.1, 0.5, 1],
    times: [0, 0.5, 1],
    gravityCoefficient: 0,
    dragCoefficient: 0,
    useInvAlpha: false,
};

/** Dust kicked up by slipping tires (`TireParticle` in deathcar.cs). */
export const TIRE_DUST: ParticleLook = {
    texture: '~/data/shapes/car/dustParticle',
    lifetime: 1,
    lifetimeVariance: 0,
    colors: [
        [0.46, 0.36, 0.26, 1],
        [0.46, 0.46, 0.36, 0],
    ],
    sizes: [0.8, 1],
    times: [0, 1],
    gravityCoefficient: -0.1,
    dragCoefficient: 2,
    useInvAlpha: true,
};
