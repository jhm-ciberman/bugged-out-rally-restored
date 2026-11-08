import * as THREE from 'three';
import type { RaceEvent } from './ai/BotRoster';
import { loadAssetManifest } from './assets/AssetPaths';
import { ModelLibrary } from './assets/ModelLibrary';
import { AudioSystem } from './audio/AudioSystem';
import { FlyCamera } from './camera/FlyCamera';
import { RaceSession } from './game/RaceSession';
import { renderPixelRatio, textureAnisotropy, touchControlsEnabled } from './game/Settings';
import type { IUpdatable } from './IUpdatable';
import { TouchControls } from './input/TouchControls';
import { DEFAULT_FOV } from './input/VehicleInput';
import { CarShadows } from './render/CarShadows';
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
    /** The player's name, shown to the other racers and on the scoreboard. */
    readonly playerName: string;
    /** Vehicle datablock of the player's car, such as `Cockroach`. */
    readonly carName: string;
    readonly event: RaceEvent;
    /** The player's total winnings, which pick the opponents' cars. */
    readonly winnings: number;
    /** Called when the player crosses the finish line of the last lap. */
    readonly onFinished?: (result: RaceResult) => void;
    /** Called with the choice made on the finish screen. */
    readonly onFinishChoice: (choice: FinishChoice) => void;
    /** Called when the player asks for the in-race menu from the touch controls. */
    readonly onPause: () => void;
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
    private _touch: TouchControls | null = null;
    private _shadows: CarShadows | null = null;
    private _fly: FlyCamera | null = null;
    /** Horizontal field of view the camera shows, in degrees (Torque measures it across). */
    private _fov = DEFAULT_FOV;
    private _viewDistanceScale = 1;

    constructor(private readonly _container: HTMLElement) {
        this._camera = new THREE.PerspectiveCamera(verticalFov(this._aspect, DEFAULT_FOV), this._aspect, 0.1, 2000);
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

    /** Everything drawn in the 3D view. */
    get scene(): THREE.Scene {
        return this._scene;
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
            playerName: start.playerName,
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
        this._shadows = new CarShadows(track, session.cars);
        this._scene.add(this._shadows.object);
        this._scene.add(session.combat.object);
        this._entities.push(session, hud);
        if (touchControlsEnabled()) {
            this._touch = new TouchControls(this._container, session.input, start.onPause);
            this._entities.push(this._touch);
        }
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

    /** Whether the free debug camera is on. */
    get flying(): boolean {
        return this._fly !== null;
    }

    /**
     * Turns the free debug camera on or off. In a race the cars keep going, the player's keys move the camera
     * instead of the car, and turning it off gives the camera back to the race.
     */
    set flying(on: boolean) {
        if (on === this.flying || !this._track) return;
        const session = this._session;
        if (on) {
            const fly = new FlyCamera(this._camera, this._renderer.domElement);
            const ahead = new THREE.Vector3(0, 0, -1)
                .applyQuaternion(this._camera.quaternion)
                .add(this._camera.position);
            fly.lookFrom(this._camera.position.clone(), ahead);
            this._fly = fly;
            this._entities.push(fly);
            if (session) {
                session.freeCamera = true;
                session.inputEnabled = false;
            }
        } else {
            const fly = this._fly;
            if (!fly) return;
            fly.dispose();
            this._entities = this._entities.filter((e) => e !== fly);
            this._fly = null;
            if (session) {
                session.freeCamera = false;
                session.inputEnabled = session.playerRacer.finishTime === null;
            }
        }
    }

    /**
     * Stops the race or free camera and frees the track. Safe to call when nothing runs.
     */
    endRace(): void {
        this._session?.dispose();
        this._hud?.dispose();
        this._touch?.dispose();
        this._shadows?.dispose();
        this._shadows = null;
        this._fly?.dispose();
        this._session = null;
        this._hud = null;
        this._touch = null;
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
        this._applyViewDistance();
        return track;
    }

    /** Multiplier on the mission's visible distance, for debugging (1 = as the mission sets it). */
    get viewDistanceScale(): number {
        return this._viewDistanceScale;
    }

    set viewDistanceScale(scale: number) {
        this._viewDistanceScale = scale;
        this._applyViewDistance();
    }

    private _applyViewDistance(): void {
        const track = this._track;
        if (!track) return;
        track.setViewDistanceScale(this._viewDistanceScale);
        this._camera.far = track.visibleDistance * this._viewDistanceScale + 50;
        this._camera.updateProjectionMatrix();
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
        this._setFov(this._session?.cameraFov ?? DEFAULT_FOV);
        this._shadows?.update(this._renderer, this._camera);
        this._renderer.render(this._scene, this._camera);
        this._hud?.render(this._renderer, this._camera);
    };

    /**
     * Applies the graphics settings that can change while the game runs.
     */
    applySettings(): void {
        this._onResize();
        const anisotropy = textureAnisotropy();
        this._scene.traverse((obj) => {
            if (!(obj instanceof THREE.Mesh)) return;
            for (const material of [obj.material].flat()) {
                const textures: unknown[] = [(material as { map?: THREE.Texture | null }).map];
                // The terrain keeps its textures in shader uniforms.
                if (material instanceof THREE.ShaderMaterial) {
                    for (const u of Object.values(material.uniforms)) textures.push(...[u.value].flat());
                }
                for (const map of textures) {
                    if (!(map instanceof THREE.Texture) || map.anisotropy === anisotropy) continue;
                    map.anisotropy = anisotropy;
                    map.needsUpdate = true;
                }
            }
        });
    }

    /**
     * Sets the camera's horizontal field of view (`setFov`), in degrees.
     */
    private _setFov(horizontal: number): void {
        if (horizontal === this._fov) return;
        this._fov = horizontal;
        this._camera.fov = verticalFov(this._aspect, horizontal);
        this._camera.updateProjectionMatrix();
    }

    private readonly _onResize = (): void => {
        this._renderer.setPixelRatio(renderPixelRatio());
        this._camera.aspect = this._aspect;
        this._camera.fov = verticalFov(this._aspect, this._fov);
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

/** Screen shape the game was made for (800x600). */
const ORIGINAL_ASPECT = 4 / 3;

/**
 * Returns the vertical field of view for a field of view of `horizontal` degrees, as Torque measures it.
 *
 * Wider screens than 4:3 keep the original's vertical view and see more at the sides; narrower ones keep
 * the full horizontal view. So no screen shows less than the original did.
 */
function verticalFov(aspect: number, horizontal: number): number {
    const h = THREE.MathUtils.degToRad(horizontal);
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / Math.min(aspect, ORIGINAL_ASPECT)));
}
