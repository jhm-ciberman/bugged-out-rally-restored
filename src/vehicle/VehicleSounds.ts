import type * as THREE from 'three';
import type { AudioSystem } from '../audio/AudioSystem';
import datablocks from '../game/data/vehicleDatablocks.json';
import type { WheeledVehicle } from './WheeledVehicle';

/** Engine volume with the wheels at full torque (`sIdleEngineVolume`). */
const IDLE_ENGINE_VOLUME = 0.2;
/** Skid volume below which the skid sound stops (`sMinSquealVolume`). */
const MIN_SQUEAL_VOLUME = 0.05;

/**
 * The engine, skid and boost loops of a car, plus its impact sounds (`WheeledVehicle::advanceTime`).
 */
export class VehicleSounds {
    private _engine: THREE.PositionalAudio | null = null;
    private _squeal: THREE.PositionalAudio | null = null;
    private _jet: THREE.PositionalAudio | null = null;
    private readonly _profiles: Record<string, string>;
    /** Whether the body counted as in the water at the last update (`Vehicle::inLiquid`, client side). */
    private _inLiquid = false;
    /** Whether the wake splash already played since the car touched the surface. */
    private _wakePlayed = false;

    private constructor(
        private readonly _vehicle: WheeledVehicle,
        private readonly _audio: AudioSystem,
        private readonly _attach: THREE.Object3D,
    ) {
        this._profiles = (datablocks.cars as Record<string, Record<string, unknown>>)[_vehicle.data.name] as Record<
            string,
            string
        >;
    }

    /**
     * Creates the sounds of `vehicle`, attached to `object` (the drawn car).
     */
    static async create(vehicle: WheeledVehicle, audio: AudioSystem, object: THREE.Object3D): Promise<VehicleSounds> {
        const s = new VehicleSounds(vehicle, audio, object);
        const p = s._profiles;
        [s._engine, s._squeal, s._jet] = await Promise.all([
            audio.loop(p.engineSound),
            audio.loop(p.squealSound),
            audio.loop(p.jetSound),
        ]);
        for (const loop of [s._engine, s._squeal, s._jet]) if (loop) object.add(loop);
        for (const name of [
            p.hardImpactSound,
            p.softImpactSound,
            p.impactWaterEasy,
            p.impactWaterMedium,
            p.impactWaterHard,
            p.exitingWater,
            p.waterWakeSound,
        ]) {
            if (name) audio.preload(name);
        }
        return s;
    }

    /**
     * Updates loop volumes and pitch from the vehicle state. Call once per frame.
     */
    update(): void {
        const wheels = this._vehicle.wheels;
        let slip = 0;
        let torque = 0;
        for (const w of wheels) {
            slip += w.slip;
            torque += w.torqueScale;
        }
        slip /= wheels.length;
        torque /= wheels.length;

        if (this._engine) {
            const level = IDLE_ENGINE_VOLUME + (1 - IDLE_ENGINE_VOLUME) * (1 - torque);
            this._engine.setVolume(level);
            this._engine.setPlaybackRate(Math.max(0.4, (level - IDLE_ENGINE_VOLUME) * 1.3));
            if (!this._engine.isPlaying && this._audio.listener.context.state === 'running') this._engine.play();
        }
        this._setLoop(this._squeal, slip >= MIN_SQUEAL_VOLUME, slip);
        this._setLoop(this._jet, this._vehicle.jetting, 1);
    }

    /**
     * Stops all loops.
     */
    dispose(): void {
        for (const loop of [this._engine, this._squeal, this._jet]) {
            if (loop?.isPlaying) loop.stop();
            loop?.removeFromParent();
        }
    }

    private _setLoop(loop: THREE.PositionalAudio | null, on: boolean, volume: number): void {
        if (!loop) return;
        if (on) {
            loop.setVolume(volume);
            if (!loop.isPlaying && this._audio.listener.context.state === 'running') loop.play();
        } else if (loop.isPlaying) {
            loop.stop();
        }
    }

    /**
     * Plays the water sounds (`Vehicle::updatePos` and `updateFroth`): a splash by speed when the body goes
     * under, another when it comes out fast, and one wake splash when it first touches the surface.
     *
     * @param coverage Share of the body under water, 0 to 1.
     * @param touchingSurface Whether the water surface crosses the body.
     */
    water(coverage: number, touchingSurface: boolean): void {
        const p = this._profiles;
        const n = (key: string) => Number(p[key] ?? 0);
        const speed = this._vehicle.rigid.linVelocity.length();
        if (!this._inLiquid && coverage >= 0.8) {
            let profile: string | null = null;
            if (speed >= n('hardSplashSoundVelocity')) profile = p.impactWaterHard;
            else if (speed >= n('mediumSplashSoundVelocity')) profile = p.impactWaterMedium;
            else if (speed >= n('softSplashSoundVelocity')) profile = p.impactWaterEasy;
            if (profile) this._play(profile);
            this._inLiquid = true;
        } else if (this._inLiquid && coverage < 0.8) {
            if (speed >= n('exitSplashSoundVelocity')) this._play(p.exitingWater);
            this._inLiquid = false;
        }
        // The engine starts the wake sound once and keeps its handle while the car stays on the surface.
        if (!touchingSurface) this._wakePlayed = false;
        else if (!this._wakePlayed) {
            this._wakePlayed = true;
            this._play(p.waterWakeSound);
        }
    }

    private _play(profile: string | undefined): void {
        if (profile)
            void this._audio.play3d(profile, this._attach.position.clone(), this._attach.parent ?? this._attach);
    }

    /**
     * Plays the crash sound for a hit that changed the car's speed by `speed` m/s.
     */
    impact(speed: number): void {
        // Client impact sounds pick hard or soft by the change of speed (`Vehicle::updatePos`).
        const data = this._vehicle.data;
        let profile: string | null = null;
        if (speed >= data.hardImpactSpeed) profile = this._profiles.hardImpactSound;
        else if (speed >= data.softImpactSpeed) profile = this._profiles.softImpactSound;
        if (profile)
            void this._audio.play3d(profile, this._attach.position.clone(), this._attach.parent ?? this._attach);
    }
}
