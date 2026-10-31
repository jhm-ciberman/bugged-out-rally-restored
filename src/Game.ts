import * as THREE from 'three';
import { loadAssetManifest } from './assets/AssetPaths';
import { ModelLibrary } from './assets/ModelLibrary';
import { FlyCamera } from './camera/FlyCamera';
import type { IUpdatable } from './IUpdatable';
import { parseVector } from './torque/TorqueMath';
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
    private _track: Track | null = null;

    constructor(private readonly _container: HTMLElement) {
        this._camera = new THREE.PerspectiveCamera(70, this._aspect, 0.1, 2000);
        this._camera.up.set(0, 0, 1);

        this._renderer = new THREE.WebGLRenderer({ antialias: true });
        this._renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this._renderer.setSize(window.innerWidth, window.innerHeight);
        this._container.appendChild(this._renderer.domElement);

        window.addEventListener('resize', this._onResize);
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

        const fly = new FlyCamera(this._camera, this._renderer.domElement);
        const spawn = track.objects.find((o) => o.className === 'SpawnSphere');
        const start = parseVector(spawn?.fields.get('position'));
        // Debug views: ?cam=x,y,z&look=x,y,z in Torque coordinates.
        const params = new URLSearchParams(window.location.search);
        const camParam = params.get('cam');
        const lookParam = params.get('look');
        if (camParam && lookParam) {
            fly.lookFrom(parseVector(camParam.replace(/,/g, ' ')), parseVector(lookParam.replace(/,/g, ' ')));
        } else {
            fly.lookFrom(start.clone().add(new THREE.Vector3(30, 30, 25)), start);
        }
        this._entities.push(fly);

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
    };

    private readonly _onResize = (): void => {
        this._camera.aspect = this._aspect;
        this._camera.updateProjectionMatrix();
        this._renderer.setSize(window.innerWidth, window.innerHeight);
    };
}
