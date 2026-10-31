import * as THREE from 'three';
import { loadAssetManifest } from './assets/AssetPaths';
import { ModelLibrary } from './assets/ModelLibrary';
import { AudioSystem } from './audio/AudioSystem';
import { FlyCamera } from './camera/FlyCamera';
import { RaceSession } from './game/RaceSession';
import type { IUpdatable } from './IUpdatable';
import { parseVector } from './torque/TorqueMath';
import { RaceHud } from './ui/RaceHud';
import { Track } from './world/Track';

// Torque blended colors without gamma correction. Keep every color in that same space.
THREE.ColorManagement.enabled = false;

/**
 * Owns the render loop, the three.js scene/camera/renderer, and every
 * updatable entity in the world. Call {@link run} to start, {@link dispose}
 * to tear down.
 */
export class Game {
    private readonly _scene = new THREE.Scene();
    private readonly _camera: THREE.PerspectiveCamera;
    private readonly _renderer: THREE.WebGLRenderer;
    private readonly _timer = new THREE.Timer();
    private readonly _entities: IUpdatable[] = [];
    private readonly _models = new ModelLibrary();
    private readonly _audio: AudioSystem;
    private _track: Track | null = null;
    private _session: RaceSession | null = null;
    private _hud: RaceHud | null = null;

    constructor(private readonly _container: HTMLElement) {
        this._camera = new THREE.PerspectiveCamera(verticalFov(this._aspect), this._aspect, 0.1, 2000);
        this._camera.up.set(0, 0, 1);
        this._audio = new AudioSystem(this._camera);

        this._renderer = new THREE.WebGLRenderer({ antialias: true });
        this._renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this._renderer.setSize(window.innerWidth, window.innerHeight);
        this._container.appendChild(this._renderer.domElement);

        window.addEventListener('resize', this._onResize);
    }

    /** The running race, or `null` in fly mode or while loading. */
    get session(): RaceSession | null {
        return this._session;
    }

    /** The loaded track, or `null` while loading. */
    get track(): Track | null {
        return this._track;
    }

    /**
     * Loads track `number` and starts the per-frame loop.
     */
    async run(number = 1): Promise<void> {
        await loadAssetManifest();
        const track = await Track.load(number, this._models, this._camera);
        this._track = track;
        this._scene.add(track.root);
        this._entities.push(track);
        this._camera.far = track.visibleDistance + 50;
        this._camera.updateProjectionMatrix();

        const params = new URLSearchParams(window.location.search);
        const drop = track.objects.find((o) => o.className === 'SpawnSphere');
        const start = parseVector(drop?.fields.get('position'));
        const camParam = params.get('cam');
        const lookParam = params.get('look');
        if (params.has('fly') || (camParam && lookParam)) {
            // Debug views: ?fly, or ?cam=x,y,z&look=x,y,z in Torque coordinates.
            const fly = new FlyCamera(this._camera, this._renderer.domElement);
            if (camParam && lookParam) {
                fly.lookFrom(parseVector(camParam.replace(/,/g, ' ')), parseVector(lookParam.replace(/,/g, ' ')));
            } else {
                fly.lookFrom(start.clone().add(new THREE.Vector3(30, 30, 25)), start);
            }
            this._entities.push(fly);
        } else {
            const hud = new RaceHud(this._container, this._audio);
            const event = params.get('event');
            const session = await RaceSession.create({
                track,
                models: this._models,
                carName: params.get('car') ?? 'Cockroach',
                event: event === 'explore' || event === 'circuit' ? event : 'single',
                winnings: Number(params.get('winnings') ?? 0),
                camera: this._camera,
                element: this._renderer.domElement,
                audio: this._audio,
                events: hud.events,
            });
            await hud.attach(session, this._models);
            this._hud = hud;
            for (const car of session.cars) this._scene.add(car.view.object);
            this._scene.add(session.combat.object);
            this._entities.push(session, hud);
            this._session = session;
            const music = track.find('MissionGroup')?.fields.get('musictrack');
            if (music) void this._audio.playMusic(music);
        }

        this._renderer.setAnimationLoop(this._tick);
    }

    /**
     * Stops the loop and releases resources and listeners.
     */
    dispose(): void {
        this._renderer.setAnimationLoop(null);
        window.removeEventListener('resize', this._onResize);
        this._renderer.dispose();
    }

    private get _aspect(): number {
        return window.innerWidth / window.innerHeight;
    }

    // Arrow fields so `this` stays bound when passed as callbacks.
    private readonly _tick = (): void => {
        this._timer.update();
        const dt = Math.min(this._timer.getDelta(), 0.1);
        for (const entity of this._entities) {
            entity.update(dt);
        }
        this._renderer.render(this._scene, this._camera);
        this._hud?.render(this._renderer, this._camera);
    };

    private readonly _onResize = (): void => {
        this._camera.aspect = this._aspect;
        this._camera.fov = verticalFov(this._aspect);
        this._camera.updateProjectionMatrix();
        this._renderer.setSize(window.innerWidth, window.innerHeight);
        this._hud?.resize(window.innerWidth, window.innerHeight);
    };
}

/** Torque's default field of view, measured horizontally (`$pref::Player::defaultFov`). */
const HORIZONTAL_FOV = 90;

function verticalFov(aspect: number): number {
    const h = THREE.MathUtils.degToRad(HORIZONTAL_FOV);
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / aspect));
}
