import { getSettings } from '../game/Settings';
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
 * Steering is relative: the mouse and keys turn the wheel, and the vehicle lets it return to center.
 */
export class VehicleInput {
    /**
     * Mouse sensitivity multiplier (`$pref::Input::LinkMouseSensitivity`, 0.2 to 1 in the options menu).
     * Set it with `?mouse=` in the URL.
     */
    sensitivity = mouseSensitivityFromUrl() ?? getSettings().mouseSensitivity;
    private readonly _keys = new Set<string>();
    private _mouseYaw = 0;
    private _resetRequested = false;
    private _rightMouse = false;
    private _leftMouse = false;

    constructor(private readonly _element: HTMLElement) {
        _element.addEventListener('click', this._onClick);
        _element.addEventListener('contextmenu', this._onContextMenu);
        document.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('mousedown', this._onMouseButton);
        window.addEventListener('mouseup', this._onMouseButton);
        window.addEventListener('blur', this._onBlur);
        document.addEventListener('pointerlockchange', this._onBlur);
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
            // The exe jets while the bomb trigger is held (`Vehicle::updateMove`, 0x4bd527).
            jet: this._keys.has('KeyD') || this._rightMouse,
        };
        this._mouseYaw = 0;
        return move;
    }

    /**
     * Returns the fire buttons: A or left mouse fires a Zinger, D or right mouse drops a Magno bomb (`config.cs`).
     */
    triggers(): { fire: boolean; drop: boolean } {
        return {
            fire: this._keys.has('KeyA') || this._leftMouse,
            drop: this._keys.has('KeyD') || this._rightMouse,
        };
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
        this._element.removeEventListener('contextmenu', this._onContextMenu);
        document.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('mousedown', this._onMouseButton);
        window.removeEventListener('mouseup', this._onMouseButton);
        window.removeEventListener('blur', this._onBlur);
        document.removeEventListener('pointerlockchange', this._onBlur);
    }

    private readonly _onClick = (): void => {
        // Raw mouse counts, like DirectInput, where the browser supports it.
        this._element.requestPointerLock({ unadjustedMovement: true })?.catch(() => this._element.requestPointerLock());
    };

    // Right mouse drops bombs, so it must not open the browser menu.
    private readonly _onContextMenu = (e: Event): void => {
        e.preventDefault();
    };

    private readonly _onMouseButton = (e: MouseEvent): void => {
        const down = e.type === 'mousedown';
        if (e.button === 0) this._leftMouse = down && document.pointerLockElement === this._element;
        if (e.button === 2) this._rightMouse = down;
    };

    // Keys released while the window is not focused never send keyup; forget them.
    private readonly _onBlur = (): void => {
        if (document.pointerLockElement === this._element && document.hasFocus()) return;
        this._keys.clear();
        this._rightMouse = false;
        this._leftMouse = false;
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

/**
 * Reads `?mouse=` from the URL, clamped to the options menu range, or `null` when it is not set.
 */
function mouseSensitivityFromUrl(): number | null {
    const raw = new URLSearchParams(window.location.search).get('mouse');
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0.2, value)) : null;
}
