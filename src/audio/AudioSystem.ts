import * as THREE from 'three';
import { resolveTorqueFile } from '../assets/AssetPaths';
import audio from '../game/data/audioProfiles.json';

interface ProfileJson {
    fileName?: string;
    description?: string;
}

interface DescriptionJson {
    volume?: number;
    isLooping?: number;
    is3D?: number;
    referenceDistance?: number;
    maxDistance?: number;
}

const profiles = audio.profiles as Record<string, ProfileJson>;
const descriptions = audio.descriptions as Record<string, DescriptionJson>;

/**
 * Plays the game's sounds through Web Audio, by Torque `AudioProfile` name.
 *
 * Browsers only start audio after the first click or key press, so sounds requested
 * before that are silent.
 */
export class AudioSystem {
    readonly listener = new THREE.AudioListener();
    private readonly _loader = new THREE.AudioLoader();
    private readonly _buffers = new Map<string, Promise<AudioBuffer | null>>();

    constructor(camera: THREE.Camera) {
        camera.add(this.listener);
        const resume = () => {
            void this.listener.context.resume();
        };
        window.addEventListener('pointerdown', resume);
        window.addEventListener('keydown', resume);
    }

    /**
     * Starts downloading the sound of `profile` so it plays without delay later.
     */
    preload(profile: string): void {
        void this._buffer(profile);
    }

    /**
     * Plays `profile` once, without position.
     */
    async play2d(profile: string, volume = 1): Promise<void> {
        const buffer = await this._buffer(profile);
        if (!buffer) return;
        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(buffer);
        sound.setVolume(volume * this._description(profile).volume);
        sound.play();
    }

    /**
     * Plays `profile` once at a world position.
     */
    async play3d(profile: string, position: THREE.Vector3, parent: THREE.Object3D, volume = 1): Promise<void> {
        const buffer = await this._buffer(profile);
        if (!buffer) return;
        const sound = this._positional(profile);
        sound.setBuffer(buffer);
        sound.setVolume(volume * this._description(profile).volume);
        sound.position.copy(position);
        parent.add(sound);
        const ended = sound.onEnded.bind(sound);
        sound.onEnded = () => {
            ended();
            parent.remove(sound);
        };
        sound.play();
    }

    /**
     * Creates a looping positional sound for `profile`, stopped. Attach it to an object and call `play()`.
     */
    async loop(profile: string): Promise<THREE.PositionalAudio | null> {
        const buffer = await this._buffer(profile);
        if (!buffer) return null;
        const sound = this._positional(profile);
        sound.setBuffer(buffer);
        sound.setLoop(true);
        return sound;
    }

    private _positional(profile: string): THREE.PositionalAudio {
        const d = this._description(profile);
        const sound = new THREE.PositionalAudio(this.listener);
        // OpenAL inverse distance, clamped between the reference and max distance.
        sound.setDistanceModel('inverse');
        sound.setRefDistance(d.referenceDistance);
        sound.setMaxDistance(d.maxDistance);
        sound.setRolloffFactor(1);
        return sound;
    }

    private _description(profile: string) {
        const d = descriptions[profiles[profile]?.description ?? ''] ?? {};
        return {
            volume: d.volume ?? 1,
            referenceDistance: d.referenceDistance ?? 1,
            maxDistance: d.maxDistance ?? 100,
        };
    }

    private _buffer(profile: string): Promise<AudioBuffer | null> {
        let pending = this._buffers.get(profile);
        if (!pending) {
            pending = this._loadBuffer(profile);
            this._buffers.set(profile, pending);
        }
        return pending;
    }

    private async _loadBuffer(profile: string): Promise<AudioBuffer | null> {
        const file = profiles[profile]?.fileName;
        if (!file) return null;
        // Some profiles name a .wav that only shipped as .ogg.
        const url = resolveTorqueFile(file) ?? resolveTorqueFile(file.replace(/\.[a-z0-9]+$/i, ''), ['.ogg', '.wav']);
        if (!url) {
            console.warn(`Missing sound for ${profile}: ${file}`);
            return null;
        }
        try {
            return await this._loader.loadAsync(url);
        } catch (err) {
            console.warn(`Sound failed to decode: ${url}`, err);
            return null;
        }
    }
}
