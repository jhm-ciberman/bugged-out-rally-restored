import type { VehicleMove } from '../vehicle/WheeledVehicle';

/** Key that puts the car back at the last checkpoint. */
const RESET_KEY = 'Enter';

/** Steering change per tick while an arrow key is held (`$pref::Input::KeyboardTurnSpeed`). */
const KEYBOARD_TURN_SPEED = 0.1;
/** Steering change per pixel of mouse movement at a 90 degree field of view (`getMouseAdjustAmount`). */
const MOUSE_TURN_PER_PIXEL = 0.01;

/**
 * Turns keyboard and mouse input into vehicle moves, with the original bindings (`config.cs`):
 * W/Up drive, S/Down reverse, Space brakes, the mouse or Left/Right steer.
 *
 * Steering is relative, like in the original: it stays where you leave it.
 */
export class VehicleInput {
    /** Mouse sensitivity multiplier (`$pref::Input::LinkMouseSensitivity`). */
    sensitivity = 1;
    private readonly _keys = new Set<string>();
    private _mouseYaw = 0;
    private _resetRequested = false;

    constructor(private readonly _element: HTMLElement) {
        _element.addEventListener('click', this._onClick);
        document.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
    }

    /**
     * Returns the move for the next tick and clears the mouse movement collected so far.
     */
    nextMove(): VehicleMove {
        const forward = this._keys.has('KeyW') || this._keys.has('ArrowUp') ? 1 : 0;
        const backward = this._keys.has('KeyS') || this._keys.has('ArrowDown') ? 1 : 0;
        const right = this._keys.has('ArrowRight') ? KEYBOARD_TURN_SPEED : 0;
        const left = this._keys.has('ArrowLeft') ? KEYBOARD_TURN_SPEED : 0;
        const move: VehicleMove = {
            throttle: forward - backward,
            yaw: this._mouseYaw + right - left,
            brake: this._keys.has('Space'),
            jet: false,
        };
        this._mouseYaw = 0;
        return move;
    }

    /**
     * Returns whether the player asked to put the car back on the track since the last call.
     */
    consumeReset(): boolean {
        const requested = this._resetRequested;
        this._resetRequested = false;
        return requested;
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

    private readonly _onClick = (): void => {
        void this._element.requestPointerLock();
    };

    private readonly _onMouseMove = (e: MouseEvent): void => {
        if (document.pointerLockElement !== this._element) return;
        this._mouseYaw += e.movementX * MOUSE_TURN_PER_PIXEL * this.sensitivity;
    };

    private readonly _onKeyDown = (e: KeyboardEvent): void => {
        this._keys.add(e.code);
        if (e.code === RESET_KEY && !e.repeat) this._resetRequested = true;
        if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    };

    private readonly _onKeyUp = (e: KeyboardEvent): void => {
        this._keys.delete(e.code);
    };
}
