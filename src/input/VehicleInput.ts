import { getSettings } from '../game/Settings';
import type { VehicleMove } from '../vehicle/WheeledVehicle';
import { type Action, actionOf, bindingOf } from './KeyBindings';

/** Key that puts the car back at the last checkpoint. */
const RESET_KEY = 'Enter';

/** Steering change per tick while a turn key is held (`$pref::Input::KeyboardTurnSpeed`). */
const KEYBOARD_TURN_SPEED = 0.1;
/** Steering change per pixel of mouse movement at a 90 degree field of view (`getMouseAdjustAmount`). */
const MOUSE_TURN_PER_PIXEL = 0.01;
/** Horizontal field of view, in degrees, without and with the zoom key (`defaultFov`, `CurrentFOV`). */
export const DEFAULT_FOV = 90;
const ZOOM_FOV = 45;

/** Torque's number for each browser mouse button (`MouseEvent.button`): left, middle, right. */
const MOUSE_BUTTONS = ['Mouse0', 'Mouse2', 'Mouse1'];

/**
 * Turns keyboard and mouse input into vehicle moves, with the bindings of the controls menu. The mouse
 * always steers, Enter puts the car back on the track.
 *
 * Steering is relative: the mouse and keys turn the wheel, and the vehicle lets it return to center.
 */
export class VehicleInput {
    /** Keys and mouse buttons held down, as stored in the bindings. */
    private readonly _held = new Set<string>();
    private _mouseYaw = 0;
    private _resetRequested = false;
    private _firstPerson = false;
    private _enabled = true;

    /**
     * Mouse sensitivity multiplier (`$pref::Input::LinkMouseSensitivity`, 0.2 to 1 in the options menu).
     * `?mouse=` in the URL overrides it.
     */
    get sensitivity(): number {
        return mouseSensitivityFromUrl() ?? getSettings().mouseSensitivity;
    }

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

    /** Whether input reaches the car. While off, keys and buttons are ignored and none count as held. */
    get enabled(): boolean {
        return this._enabled;
    }

    set enabled(enabled: boolean) {
        this._enabled = enabled;
        if (!enabled) {
            this._held.clear();
            this._mouseYaw = 0;
        }
    }

    /** Whether the player picked the first person view (`$firstPerson`). */
    get firstPerson(): boolean {
        return this._firstPerson;
    }

    /** Horizontal field of view, in degrees, for the zoom key's state. */
    get fov(): number {
        return this._isHeld('zoom') ? ZOOM_FOV : DEFAULT_FOV;
    }

    /**
     * Returns the move for the next tick and clears the mouse movement collected so far.
     */
    nextMove(): VehicleMove {
        const forward = this._isHeld('throttle') || this._isHeld('altThrottle') ? 1 : 0;
        const backward = this._isHeld('reverse') || this._isHeld('altReverse') ? 1 : 0;
        const right = this._isHeld('turnRight') ? KEYBOARD_TURN_SPEED : 0;
        const left = this._isHeld('turnLeft') ? KEYBOARD_TURN_SPEED : 0;
        const move: VehicleMove = {
            throttle: forward - backward,
            yaw: this._mouseYaw + right - left,
            brake: this._isHeld('brake'),
            // The exe jets while the bomb trigger is held (`Vehicle::updateMove`, 0x4bd527).
            jet: this.triggers().drop,
        };
        this._mouseYaw = 0;
        return move;
    }

    /**
     * Returns the fire buttons: whether a Zinger fire or a Magno bomb drop binding is held.
     */
    triggers(): { fire: boolean; drop: boolean } {
        return {
            fire: this._isHeld('fire') || this._isHeld('altFire'),
            drop: this._isHeld('drop') || this._isHeld('altDrop'),
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

    private _isHeld(action: Action): boolean {
        const input = bindingOf(action);
        return input !== null && this._held.has(input);
    }

    // Buttons only count while the mouse is captured, so the click that captures it does not fire.
    private readonly _onMouseButton = (e: MouseEvent): void => {
        const input = MOUSE_BUTTONS[e.button];
        if (!input || !this._enabled) return;
        if (e.type === 'mousedown' && document.pointerLockElement === this._element) this._press(input, false);
        else this._held.delete(input);
    };

    // Keys released while the window is not focused never send keyup; forget them.
    private readonly _onBlur = (): void => {
        if (document.pointerLockElement === this._element && document.hasFocus()) return;
        this._held.clear();
    };

    private readonly _onMouseMove = (e: MouseEvent): void => {
        if (document.pointerLockElement !== this._element || !this._enabled) return;
        // A narrower view turns slower, so the aim moves the same on screen (`getMouseAdjustAmount`).
        this._mouseYaw += e.movementX * MOUSE_TURN_PER_PIXEL * (this.fov / DEFAULT_FOV) * this.sensitivity;
    };

    private readonly _onKeyDown = (e: KeyboardEvent): void => {
        if (!this._enabled) return;
        if (e.code === RESET_KEY && !e.repeat) this._resetRequested = true;
        // Bound keys must not scroll the page or move the focus.
        if (actionOf(e.code)) e.preventDefault();
        this._press(e.code, e.repeat);
    };

    private readonly _onKeyUp = (e: KeyboardEvent): void => {
        this._held.delete(e.code);
    };

    private _press(input: string, repeat: boolean): void {
        this._held.add(input);
        if (!repeat && actionOf(input) === 'firstPerson') this._firstPerson = !this._firstPerson;
    }
}

/**
 * Reads `?mouse=` from the URL, clamped to the options menu range, or `null` when it is not set.
 */
function mouseSensitivityFromUrl(): number | null {
    const raw = new URLSearchParams(window.location.search).get('mouse');
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0.2, value)) : null;
}
