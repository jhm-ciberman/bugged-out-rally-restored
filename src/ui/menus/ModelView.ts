import * as THREE from 'three';
import type { ModelLibrary } from '../../assets/ModelLibrary';

/** Seconds per turn of the turntable. */
const TURN_SECONDS = 8;

/**
 * A small 3D view that shows one model on a slow turntable (`GuiObjectView`, used for the car on
 * the player selection menu). How the original view moved its camera is native and not known.
 */
export class ModelView {
    readonly element: HTMLCanvasElement;
    private readonly _renderer: THREE.WebGLRenderer;
    private readonly _scene = new THREE.Scene();
    private readonly _camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
    private readonly _pivot = new THREE.Group();
    private _request = 0;
    private _load = 0;

    constructor(private readonly _models: ModelLibrary) {
        this._renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this._renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        this.element = this._renderer.domElement;
        this._camera.up.set(0, 0, 1);
        this._scene.add(this._pivot);
        this._scene.add(new THREE.AmbientLight(0xffffff, Math.PI * 0.55));
        const sun = new THREE.DirectionalLight(0xffffff, Math.PI * 0.6);
        sun.position.set(-2, -3, 4);
        this._scene.add(sun);
        this._request = requestAnimationFrame(this._frame);
    }

    /**
     * Shows the model of a Torque shape, replacing the current one. `null` empties the view.
     */
    async show(torquePath: string | null): Promise<void> {
        const load = ++this._load;
        this._pivot.clear();
        if (!torquePath) return;
        const model = await this._models.instantiate(torquePath);
        if (!model || load !== this._load) return;
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        this._pivot.add(model);
        const radius = box.getSize(new THREE.Vector3()).length() / 2;
        this._camera.position.set(0, -radius * 2.6, radius * 0.9);
        this._camera.lookAt(0, 0, 0);
    }

    dispose(): void {
        cancelAnimationFrame(this._request);
        this._renderer.dispose();
        this.element.remove();
    }

    private readonly _frame = (time: number): void => {
        this._request = requestAnimationFrame(this._frame);
        const w = this.element.clientWidth;
        const h = this.element.clientHeight;
        if (w === 0 || h === 0) return;
        if (this.element.width !== w * devicePixelRatio || this.element.height !== h * devicePixelRatio) {
            this._renderer.setPixelRatio(devicePixelRatio);
            this._renderer.setSize(w, h, false);
            this._camera.aspect = w / h;
            this._camera.updateProjectionMatrix();
        }
        this._pivot.rotation.z = ((time / 1000) * Math.PI * 2) / TURN_SECONDS;
        this._renderer.render(this._scene, this._camera);
    };
}
