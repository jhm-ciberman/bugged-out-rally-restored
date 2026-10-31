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
        audio.preload(p.hardImpactSound);
        audio.preload(p.softImpactSound);
        vehicle.onImpact = (change) => s._impact(change.length());
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
        this._vehicle.onImpact = null;
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

    private _impact(speed: number): void {
        // Client impact sounds pick hard or soft by the change of speed (`Vehicle::updatePos`).
        const data = this._vehicle.data;
        let profile: string | null = null;
        if (speed >= data.hardImpactSpeed) profile = this._profiles.hardImpactSound;
        else if (speed >= data.softImpactSpeed) profile = this._profiles.softImpactSound;
        if (profile)
            void this._audio.play3d(profile, this._attach.position.clone(), this._attach.parent ?? this._attach);
    }
}
