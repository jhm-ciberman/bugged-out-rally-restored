import * as THREE from 'three';
import { resolveTorqueFile } from '../assets/AssetPaths';
import audio from '../game/data/audioProfiles.json';
import { getSettings } from '../game/Settings';

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
    type?: string | number;
}

/** Key that toggles mute. */
const MUTE_KEY = 'KeyM';
const MUTE_STORAGE_KEY = 'bor.muted';

function readStoredMute(): boolean {
    try {
        return localStorage.getItem(MUTE_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
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
    private _music: THREE.Audio | null = null;
    private _muted = false;
    /** Channel 1 (music and menu sounds) and channel 2 (world sounds), as in the options menu. */
    private readonly _guiChannel: GainNode;
    private readonly _simChannel: GainNode;

    constructor(camera: THREE.Camera) {
        camera.add(this.listener);
        const context = this.listener.context;
        this._guiChannel = context.createGain();
        this._simChannel = context.createGain();
        this._guiChannel.connect(this.listener.getInput());
        this._simChannel.connect(this.listener.getInput());
        this.applySettings();
        const resume = () => {
            void this.listener.context.resume();
        };
        window.addEventListener('pointerdown', resume);
        window.addEventListener('keydown', resume);
        window.addEventListener('keydown', (e) => {
            if (e.code === MUTE_KEY && !e.repeat) this.muted = !this.muted;
        });
        // ?mute silences this page only, without changing the remembered setting.
        this._muted = new URLSearchParams(window.location.search).has('mute') || readStoredMute();
        this.listener.setMasterVolume(this._muted ? 0 : 1);
    }

    /**
     * Applies the volume sliders of the options menu.
     */
    applySettings(): void {
        const s = getSettings();
        this._guiChannel.gain.value = s.musicVolume;
        this._simChannel.gain.value = s.soundVolume;
    }

    /** Whether all sound is silenced. Toggled with the M key, remembered between visits. */
    get muted(): boolean {
        return this._muted;
    }

    set muted(value: boolean) {
        this._muted = value;
        this.listener.setMasterVolume(value ? 0 : 1);
        try {
            localStorage.setItem(MUTE_STORAGE_KEY, value ? '1' : '0');
        } catch {
            // Storage can be unavailable (private mode); muting still works for this visit.
        }
    }

    /**
     * Starts downloading the sound of `profile` so it plays without delay later.
     */
    preload(profile: string): void {
        void this._buffer(profile);
    }

    /**
     * Starts looping `profile` as the background music, replacing the current one.
     */
    async playMusic(profile: string): Promise<void> {
        this.stopMusic();
        const buffer = await this._buffer(profile);
        if (!buffer) return;
        const music = new THREE.Audio(this.listener);
        this._route(music, profile);
        music.setBuffer(buffer);
        music.setLoop(true);
        music.setVolume(this._description(profile).volume);
        this._music = music;
        const start = () => {
            if (this._music === music && !music.isPlaying) music.play();
        };
        if (this.listener.context.state === 'running') start();
        else void this.listener.context.resume().then(start);
        this.listener.context.addEventListener('statechange', start, { once: true });
    }

    stopMusic(): void {
        if (this._music?.isPlaying) this._music.stop();
        this._music = null;
    }

    /**
     * Plays `profile` once, without position.
     */
    async play2d(profile: string, volume = 1): Promise<void> {
        const buffer = await this._buffer(profile);
        if (!buffer) return;
        const sound = new THREE.Audio(this.listener);
        this._route(sound, profile);
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
        this._route(sound, profile);
        return sound;
    }

    /**
     * Sends a sound through the volume channel of its profile's description (`type`).
     */
    private _route(sound: THREE.Audio | THREE.PositionalAudio, profile: string): void {
        const type = String(descriptions[profiles[profile]?.description ?? '']?.type ?? '');
        const gui = type.includes('Gui') || type === '1';
        sound.gain.disconnect();
        sound.gain.connect(gui ? this._guiChannel : this._simChannel);
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
