import * as THREE from 'three';
import {
    EXPLOSION_BUBBLE,
    EXPLOSION_FIRE,
    EXPLOSION_SMOKE,
    EXPLOSION_SPARKS,
    EXPLOSION_WATER_SPARK,
    type ParticleLook,
    SPIT_SPLAT,
} from '../render/Particles';

/**
 * One burst of particles thrown out by an explosion: its `particleEmitter` or one of its `emitter[]`.
 */
export interface ExplosionBurst {
    readonly look: ParticleLook;
    /** Particles in the burst: `particleDensity`, or an emitter's life divided by its ejection period. */
    readonly count: number;
    /** Ejection speed and its variance, in m/s. */
    readonly speed: number;
    readonly speedVariance: number;
    /** Radius of the ball the particles start in (`particleRadius`). */
    readonly radius?: number;
    /** Height above the blast where the burst starts (a sub-explosion's `offset`). */
    readonly offset?: number;
}

/**
 * An explosion (`ExplosionData`): particles, a sound, a flash of light and a camera shake.
 */
export interface ExplosionData {
    readonly bursts: readonly ExplosionBurst[];
    /** Audio profile played at the blast. */
    readonly sound: string;
    /** Color of the flash at its start; it fades to black over the explosion's life. */
    readonly lightColor: THREE.Color;
    /** Camera shake, or `null` for none (`shakeCamera`, `camShake*`). */
    readonly shake: ExplosionShake | null;
}

/**
 * How an explosion shakes cameras near it.
 */
export interface ExplosionShake {
    readonly amplitude: number;
    readonly frequency: THREE.Vector3;
    readonly seconds: number;
    readonly radius: number;
}

const FIRE_BALL: ExplosionBurst = { look: EXPLOSION_FIRE, count: 100, speed: 0.8, speedVariance: 0.5, radius: 2 };
/** Smoke every 10 ms for 250 ms at 4 m/s. */
const SMOKE: ExplosionBurst = { look: EXPLOSION_SMOKE, count: 25, speed: 4, speedVariance: 0.5 };
/** Sparks every 2 ms for 150 ms at 30 m/s. */
const SPARKS: ExplosionBurst = { look: EXPLOSION_SPARKS, count: 75, speed: 30, speedVariance: 10 };
const SHAKE: ExplosionShake = { amplitude: 1, frequency: new THREE.Vector3(10, 11, 10), seconds: 0.5, radius: 10 };

/** A Zinger or Magno bomb going off (`RocketExplosion`). */
export const ROCKET_EXPLOSION: ExplosionData = {
    bursts: [FIRE_BALL, SMOKE, SPARKS],
    sound: 'RocketExplosionSound',
    lightColor: new THREE.Color(0.5, 0.5, 0),
    shake: SHAKE,
};

/** A wrecked car blowing up (`VehicleExplosion`): the rocket explosion with its own sound profile. */
export const VEHICLE_EXPLOSION: ExplosionData = { ...ROCKET_EXPLOSION, sound: 'VehicleExplosionSound' };

/** A wrecked car blowing up under water (`VehicleWaterExplosion` and its `VehicleSubWaterExplosion1`). */
export const VEHICLE_WATER_EXPLOSION: ExplosionData = {
    bursts: [
        { ...FIRE_BALL, count: 300, radius: 1 },
        // Bubbles every 9 ms over the explosion's default 1 s life.
        { look: EXPLOSION_BUBBLE, count: 110, speed: 1, speedVariance: 0.5 },
        { look: EXPLOSION_BUBBLE, count: 110, speed: 1, speedVariance: 0.5, offset: 1.2 },
        // Water sparks every 3 ms for 200 ms.
        { look: EXPLOSION_WATER_SPARK, count: 67, speed: 4, speedVariance: 4, offset: 1.2 },
    ],
    sound: 'LiquidExplosionSound',
    lightColor: new THREE.Color(0, 0.5, 0.5),
    shake: { amplitude: 3, frequency: new THREE.Vector3(8, 9, 7), seconds: 1.3, radius: 20 },
};

/** A Zinger or Magno bomb going off under water (`RocketWaterExplosion`): the same as a car's. */
export const ROCKET_WATER_EXPLOSION: ExplosionData = VEHICLE_WATER_EXPLOSION;

/** Frog spit splatting (`SpitExplosion`): a ball of green blobs. */
export const SPIT_EXPLOSION: ExplosionData = {
    bursts: [{ look: SPIT_SPLAT, count: 200, speed: 0.8, speedVariance: 0.5, radius: 4 }],
    sound: 'SpitExplosionSound',
    lightColor: new THREE.Color(0.1, 0.9, 0.1),
    shake: SHAKE,
};
