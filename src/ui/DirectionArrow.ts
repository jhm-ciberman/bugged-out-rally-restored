import * as THREE from 'three';
import type { ModelLibrary } from '../assets/ModelLibrary';
import { controlBounds } from './GuiLayout';
import { ARROW_RECT } from './Hud';

const _dir = new THREE.Vector3();
const _inv = new THREE.Quaternion();
const _basis = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();

/**
 * The 3D arrow at the top of the HUD that points at the next checkpoint (`DirectionalArrow` in PlayGui.gui).
 *
 * It is drawn in its own small viewport over the game view.
 */
export class DirectionArrow {
    private readonly _scene = new THREE.Scene();
    private readonly _camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20);
    private _arrow: THREE.Object3D | null = null;

    /**
     * Loads the arrow model.
     */
    async load(models: ModelLibrary): Promise<void> {
        this._arrow = await models.instantiate('bor/client/ui/arrow.dts');
        if (this._arrow) this._scene.add(this._arrow);
        this._scene.add(new THREE.AmbientLight(0xffffff, Math.PI * 0.6));
        const sun = new THREE.DirectionalLight(0xffffff, Math.PI * 0.6);
        sun.position.set(0.3, -1, 1);
        this._scene.add(sun);
        this._camera.up.set(0, 0, 1);
        this._camera.position.set(0, -3.2, 0.5);
        this._camera.lookAt(0, 0, 0);
    }

    /**
     * Turns the arrow toward `target` as seen from `viewer`, then draws it.
     */
    render(
        renderer: THREE.WebGLRenderer,
        viewer: THREE.Camera,
        from: THREE.Vector3,
        target: THREE.Vector3 | undefined,
    ): void {
        if (!this._arrow || !target) return;

        // Direction to the target in the viewer's frame, where the viewer looks along +Y with +Z up.
        _dir.subVectors(target, from).normalize().applyQuaternion(_inv.copy(viewer.quaternion).invert());
        const forward = new THREE.Vector3(_dir.x, -_dir.z, _dir.y);
        _x.crossVectors(forward, new THREE.Vector3(0, 0, 1));
        if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
        _x.normalize();
        _z.crossVectors(_x, forward).normalize();
        _basis.makeBasis(_x, forward, _z);
        this._arrow.quaternion.setFromRotationMatrix(_basis);

        const size = renderer.getSize(new THREE.Vector2());
        const b = controlBounds(ARROW_RECT, size.x, size.y);
        this._camera.aspect = b.w / b.h;
        this._camera.updateProjectionMatrix();
        const bottom = size.y - b.y - b.h;
        renderer.setScissorTest(true);
        renderer.setScissor(b.x, bottom, b.w, b.h);
        renderer.setViewport(b.x, bottom, b.w, b.h);
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(this._scene, this._camera);
        renderer.autoClear = autoClear;
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, size.x, size.y);
    }
}
