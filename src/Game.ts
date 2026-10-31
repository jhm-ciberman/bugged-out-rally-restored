import * as THREE from 'three';
import type { RaceEvent } from './ai/BotRoster';
import { loadAssetManifest } from './assets/AssetPaths';
import { ModelLibrary } from './assets/ModelLibrary';
import { AudioSystem } from './audio/AudioSystem';
import { FlyCamera } from './camera/FlyCamera';
import { RaceSession } from './game/RaceSession';
import { renderPixelRatio } from './game/Settings';
import type { IUpdatable } from './IUpdatable';
import { parseVector } from './torque/TorqueMath';
import type { FinishChoice } from './ui/FinishScreen';
import { RaceHud } from './ui/RaceHud';
import { Track } from './world/Track';

// Torque blended colors without gamma correction. Keep every color in that same space.
THREE.ColorManagement.enabled = false;

/**
 * Everything needed to start a race.
 */
export interface RaceStart {
    /** Track number, 1 to 8. */
    readonly track: number;
    /** Vehicle datablock of the player's car, such as `Cockroach`. */
    readonly carName: string;
    readonly event: RaceEvent;
    /** The player's total winnings, which pick the opponents' cars. */
    readonly winnings: number;
    /** Called when the player crosses the finish line of the last lap. */
    readonly onFinished?: (result: RaceResult) => void;
    /** Called with the choice made on the finish screen. */
    readonly onFinishChoice: (choice: FinishChoice) => void;
    /** Whether the player may race `track` (1 to 8) next, for the finish screen's track picker. */
    readonly canRace: (track: number) => boolean;
    /** Reports loading steps and progress (0 to 1). */
    readonly onProgress?: (step: string, fraction: number) => void;
}

/**
 * How the player did.
 */
export interface RaceResult {
    /** Place at the finish, 1 = first. */
    readonly place: number;
    /** Kill score: wrecks caused minus own wrecks. */
    readonly kills: number;
    /** Cars in the race, the player included. */
    readonly racers: number;
}

/**
 * Owns the renderer, the scene and the frame loop, and runs one race (or a free camera) at a time.
 */
export class Game {
    private readonly _scene = new THREE.Scene();
    private readonly _camera: THREE.PerspectiveCamera;
    private readonly _renderer: THREE.WebGLRenderer;
    private readonly _timer = new THREE.Timer();
    private _entities: IUpdatable[] = [];
    readonly models = new ModelLibrary();
    readonly audio: AudioSystem;
    private _track: Track | null = null;
    private _session: RaceSession | null = null;
    private _hud: RaceHud | null = null;
    private _fly: FlyCamera | null = null;

    constructor(private readonly _container: HTMLElement) {
        this._camera = new THREE.PerspectiveCamera(verticalFov(this._aspect), this._aspect, 0.1, 2000);
        this._camera.up.set(0, 0, 1);
        this.audio = new AudioSystem(this._camera);

        this._renderer = new THREE.WebGLRenderer({ antialias: true });
        this._renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        this._renderer.setPixelRatio(renderPixelRatio());
        this._renderer.setSize(window.innerWidth, window.innerHeight);
        this._container.appendChild(this._renderer.domElement);

        window.addEventListener('resize', this._onResize);
        this._renderer.setAnimationLoop(this._tick);
    }

    /** The running race, or `null`. */
    get session(): RaceSession | null {
        return this._session;
    }

    /** The loaded track, or `null`. */
    get track(): Track | null {
        return this._track;
    }

    /** The canvas the game draws into. */
    get canvas(): HTMLCanvasElement {
        return this._renderer.domElement;
    }

    /**
     * Loads the list of game files. Call once before anything else.
     */
    async init(): Promise<void> {
        await loadAssetManifest();
    }

    /**
     * Loads a track and starts a race on it, replacing whatever was running.
     */
    async startRace(start: RaceStart): Promise<void> {
        this.endRace();
        start.onProgress?.('LOADING OBJECTS', 0.2);
        const track = await this._loadTrack(start.track);
        start.onProgress?.('LIGHTING MISSION', 0.7);

        const hud = new RaceHud(this._container, this.audio, start.event, start.track, {
            onChoice: start.onFinishChoice,
            canRace: start.canRace,
        });
        const session = await RaceSession.create({
            track,
            models: this.models,
            carName: start.carName,
            event: start.event,
            winnings: start.winnings,
            camera: this._camera,
            element: this._renderer.domElement,
            audio: this.audio,
            events: hud.events,
        });
        hud.onPlayerFinished = () => {
            start.onFinished?.({
                place: session.race.positionOf(session.playerRacer),
                kills: session.player.score,
                racers: session.race.racers.length,
            });
        };
        await hud.attach(session, this.models);
        start.onProgress?.('LIGHTING MISSION', 1);

        this._hud = hud;
        this._session = session;
        for (const car of session.cars) this._scene.add(car.view.object);
        this._scene.add(session.combat.object);
        this._entities.push(session, hud);
        const music = track.find('MissionGroup')?.fields.get('musictrack');
        if (music) void this.audio.playMusic(music);
    }

    /**
     * Loads a track with a free-flying camera, for looking around (debug).
     *
     * @param from Camera position, or near the start line when omitted.
     */
    async startFly(trackNumber: number, from?: THREE.Vector3, lookAt?: THREE.Vector3): Promise<void> {
        this.endRace();
        const track = await this._loadTrack(trackNumber);
        const fly = new FlyCamera(this._camera, this._renderer.domElement);
        const drop = track.objects.find((o) => o.className === 'SpawnSphere');
        const start = parseVector(drop?.fields.get('position'));
        fly.lookFrom(from ?? start.clone().add(new THREE.Vector3(30, 30, 25)), lookAt ?? start);
        this._fly = fly;
        this._entities.push(fly);
    }

    /**
     * Stops the race or free camera and frees the track. Safe to call when nothing runs.
     */
    endRace(): void {
        this._session?.dispose();
        this._hud?.dispose();
        this._fly?.dispose();
        this._session = null;
        this._hud = null;
        this._fly = null;
        this._entities = [];
        this.audio.stopMusic();
        if (this._track) {
            disposeObject(this._track.root);
            this._track = null;
        }
        this._scene.clear();
        if (document.pointerLockElement) document.exitPointerLock();
    }

    private async _loadTrack(number: number): Promise<Track> {
        const track = await Track.load(number, this.models, this._camera);
        this._track = track;
        this._scene.add(track.root);
        this._entities.push(track);
        this._camera.far = track.visibleDistance + 50;
        this._camera.updateProjectionMatrix();
        return track;
    }

    private get _aspect(): number {
        return window.innerWidth / window.innerHeight;
    }

    // Arrow fields so `this` stays bound when passed as callbacks.
    private readonly _tick = (): void => {
        this._timer.update();
        const dt = Math.min(this._timer.getDelta(), 0.1);
        if (!this._track) return;
        for (const entity of this._entities) entity.update(dt);
        this._renderer.render(this._scene, this._camera);
        this._hud?.render(this._renderer, this._camera);
    };

    /**
     * Applies the graphics settings that can change while the game runs.
     */
    applySettings(): void {
        this._onResize();
    }

    private readonly _onResize = (): void => {
        this._renderer.setPixelRatio(renderPixelRatio());
        this._camera.aspect = this._aspect;
        this._camera.fov = verticalFov(this._aspect);
        this._camera.updateProjectionMatrix();
        this._renderer.setSize(window.innerWidth, window.innerHeight);
        this._hud?.resize(window.innerWidth, window.innerHeight);
    };
}

/**
 * Frees the GPU memory of everything under `root`. Shared models are uploaded again if reused.
 */
function disposeObject(root: THREE.Object3D): void {
    root.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh || obj instanceof THREE.Sprite)) return;
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of materials) {
            const values: unknown[] = Object.values(m);
            if (m instanceof THREE.ShaderMaterial) {
                for (const u of Object.values(m.uniforms)) values.push(...[u.value].flat());
            }
            for (const value of values) if (value instanceof THREE.Texture) value.dispose();
            m.dispose();
        }
    });
}

/** Torque's default field of view, measured horizontally (`$pref::Player::defaultFov`). */
const HORIZONTAL_FOV = 90;

function verticalFov(aspect: number): number {
    const h = THREE.MathUtils.degToRad(HORIZONTAL_FOV);
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / aspect));
}
