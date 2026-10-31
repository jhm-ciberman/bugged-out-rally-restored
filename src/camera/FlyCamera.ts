import * as THREE from 'three';
import type { IUpdatable } from '../IUpdatable';

const LOOK_SPEED = 0.0025;
const BASE_SPEED = 40;

/**
 * A free-flying debug camera for Torque space (Z up).
 *
 * Click the canvas to capture the mouse. WASD moves, Q/E go down/up, Shift is faster.
 */
export class FlyCamera implements IUpdatable {
    private readonly _keys = new Set<string>();
    private _yaw = 0;
    private _pitch = 0;

    constructor(
        private readonly _camera: THREE.PerspectiveCamera,
        private readonly _element: HTMLElement,
    ) {
        _element.addEventListener('click', this._onClick);
        document.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
    }

    /**
     * Places the camera at `position`, looking at `target`.
     */
    lookFrom(position: THREE.Vector3, target: THREE.Vector3): void {
        this._camera.position.copy(position);
        const dir = target.clone().sub(position).normalize();
        this._yaw = Math.atan2(-dir.x, dir.y);
        this._pitch = Math.asin(THREE.MathUtils.clamp(dir.z, -1, 1));
        this._applyRotation();
    }

    update(deltaSeconds: number): void {
        const forward = new THREE.Vector3(
            -Math.sin(this._yaw) * Math.cos(this._pitch),
            Math.cos(this._yaw) * Math.cos(this._pitch),
            Math.sin(this._pitch),
        );
        const right = new THREE.Vector3(Math.cos(this._yaw), Math.sin(this._yaw), 0);
        const move = new THREE.Vector3();
        if (this._keys.has('KeyW')) move.add(forward);
        if (this._keys.has('KeyS')) move.sub(forward);
        if (this._keys.has('KeyD')) move.add(right);
        if (this._keys.has('KeyA')) move.sub(right);
        if (this._keys.has('KeyE')) move.z += 1;
        if (this._keys.has('KeyQ')) move.z -= 1;
        const speed = BASE_SPEED * (this._keys.has('ShiftLeft') ? 5 : 1);
        this._camera.position.addScaledVector(move, speed * deltaSeconds);
    }

    /**
     * Removes the input listeners.
     */
    dispose(): void {
        this._element.removeEventListener('click', this._onClick);
        document.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
    }

    private _applyRotation(): void {
        // Camera looks down its local -Z. Turn it to look along Torque +Y first, then yaw about Z and pitch about X.
        this._camera.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2 + this._pitch, 0, this._yaw, 'ZXY'));
    }

    private readonly _onClick = (): void => {
        void this._element.requestPointerLock();
    };

    private readonly _onMouseMove = (e: MouseEvent): void => {
        if (document.pointerLockElement !== this._element) return;
        this._yaw -= e.movementX * LOOK_SPEED;
        this._pitch = THREE.MathUtils.clamp(this._pitch - e.movementY * LOOK_SPEED, -1.5, 1.5);
        this._applyRotation();
    };

    private readonly _onKeyDown = (e: KeyboardEvent): void => {
        this._keys.add(e.code);
    };

    private readonly _onKeyUp = (e: KeyboardEvent): void => {
        this._keys.delete(e.code);
    };
}
