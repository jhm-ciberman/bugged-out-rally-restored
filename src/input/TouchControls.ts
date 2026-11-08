import type { IUpdatable } from '../IUpdatable';
import {
    controlBounds,
    DESIGN_HEIGHT,
    DESIGN_WIDTH,
    type GuiRect,
    hudScale,
    placeControl,
    scaleAnchoredRect,
} from '../ui/GuiLayout';
import type { Action } from './KeyBindings';
import type { VehicleInput } from './VehicleInput';

/**
 * Returns the markup of a solid white 24x24 icon.
 */
export function touchIcon(path: string): string {
    return `<svg viewBox="0 0 24 24" style="width:62%;height:62%" fill="#fff" fill-rule="evenodd"><path d="${path}"/></svg>`;
}

/**
 * What an on-screen touch button looks like and where it goes.
 */
export interface TouchButtonLook {
    /** The button's accessible name. */
    readonly name: string;
    /** The button's picture, or `null` for a frame around a HUD icon. */
    readonly icon: string | null;
    readonly rect: GuiRect;
    /** Whether the button sits beside the HUD's ammo icons, so its distance from them follows the HUD. */
    readonly besideAmmo?: boolean;
    /** The tallest the button can be at the HUD's design size, in pixels. */
    readonly maxHeight?: number;
}

/** A button whose action stays on while a finger is on it. */
interface HoldButton extends TouchButtonLook {
    readonly action: Action;
}

/** A button that runs once per tap and is never held. */
interface TapButton extends TouchButtonLook {
    readonly command: 'reset' | 'pause';
}

/** The driving buttons. Fire and bomb frame the HUD's ammo icons. */
const HOLD_BUTTONS: readonly HoldButton[] = [
    {
        action: 'turnLeft',
        name: 'Steer left',
        icon: touchIcon('M15.5 3l-9 9 9 9 3.5-3.5-5.5-5.5L19 6.5z'),
        rect: { x: 12, y: 468, w: 96, h: 122, horiz: 'right', vert: 'top' },
    },
    {
        action: 'turnRight',
        name: 'Steer right',
        icon: touchIcon('M8.5 3l9 9-9 9L5 17.5l5.5-5.5L5 6.5z'),
        rect: { x: 116, y: 468, w: 96, h: 122, horiz: 'right', vert: 'top' },
    },
    {
        action: 'throttle',
        name: 'Gas',
        icon: touchIcon(
            'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM9 6v2h6V6zM9 11v2h6v-2zM9 16v2h6v-2z',
        ),
        besideAmmo: true,
        rect: { x: 584, y: 466, w: 124, h: 124, horiz: 'left', vert: 'top' },
    },
    {
        action: 'brake',
        name: 'Brake',
        icon: touchIcon(
            'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM5 9v2h14V9zM5 13v2h14v-2z',
        ),
        besideAmmo: true,
        rect: { x: 598, y: 382, w: 96, h: 76, horiz: 'left', vert: 'top' },
    },
    {
        action: 'fire',
        name: 'Fire Zinger',
        icon: null,
        rect: { x: 717, y: 440, w: 78, h: 74, horiz: 'left', vert: 'top' },
    },
    {
        action: 'drop',
        name: 'Drop Magno bomb',
        icon: null,
        rect: { x: 717, y: 515, w: 78, h: 74, horiz: 'left', vert: 'top' },
    },
];

/** The small corner buttons. They stay clear of the message log and the lap counter. */
const TAP_BUTTONS: readonly TapButton[] = [
    {
        command: 'reset',
        name: 'Back on track',
        icon: touchIcon(
            'M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8zM10.5 10h3a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z',
        ),
        // The message log starts just below it.
        maxHeight: 56,
        rect: { x: 8, y: 1, w: 44, h: 44, horiz: 'right', vert: 'bottom' },
    },
    {
        command: 'pause',
        name: 'Pause',
        icon: touchIcon('M6 4h4.5v16H6zM13.5 4H18v16h-4.5z'),
        rect: { x: 748, y: 60, w: 44, h: 44, horiz: 'left', vert: 'bottom' },
    },
];

/** Pixels a finger can stray past a held button before it lets go, so a drifting thumb keeps driving. */
export const STICKY_MARGIN = 12;
/** Screen height below which the buttons shrink. */
const REFERENCE_HEIGHT = 390;
/** Pixels of the shortest side of a button, however small the screen is. */
const MIN_TARGET_SIZE = 56;
/** Pixels from the right edge of the screen that the HUD's ammo icons and their frames take up at the HUD's design size. */
const AMMO_COLUMN_WIDTH = 83;
/** Fill of a button no finger is on. */
const BUTTON_FILL = 'rgba(255, 255, 255, 0.1)';
/** Fill of a button a finger is on. */
const PRESSED_FILL = 'rgba(255, 192, 55, 0.55)';

/**
 * The on-screen buttons for playing a race on a touch screen, laid out for a phone in landscape. Any number of
 * fingers can hold buttons at once. The buttons hide and let go whenever race input is off.
 */
export class TouchControls implements IUpdatable {
    private readonly _root = document.createElement('div');
    private readonly _views = new Map<TouchButtonLook, HTMLElement>();
    /** The button under each finger on the overlay, by pointer id, or `null` for a finger on no button. */
    private readonly _fingers = new Map<number, HoldButton | null>();
    private _shown = true;

    constructor(
        parent: HTMLElement,
        private readonly _input: VehicleInput,
        private readonly _onPause: () => void,
    ) {
        const root = this._root;
        // Above the HUD and below the menus (`main.ts`). The buttons ignore pointers: the root hit-tests fingers
        // itself, so a finger can slide from one button to another.
        Object.assign(root.style, {
            position: 'absolute',
            inset: '0',
            zIndex: '5',
            overflow: 'hidden',
            touchAction: 'none',
            userSelect: 'none',
            webkitUserSelect: 'none',
            webkitTouchCallout: 'none',
        });
        for (const button of [...HOLD_BUTTONS, ...TAP_BUTTONS]) this._addView(button);
        root.addEventListener('pointerdown', this._onPointerDown);
        root.addEventListener('pointermove', this._onPointerMove);
        root.addEventListener('pointerup', this._onPointerEnd);
        root.addEventListener('pointercancel', this._onPointerEnd);
        root.addEventListener('contextmenu', this._preventDefault);
        // Backs up `touch-action: none` for browsers that support it only in part.
        root.addEventListener('touchstart', this._preventDefault, { passive: false });
        root.addEventListener('touchmove', this._preventDefault, { passive: false });
        window.addEventListener('resize', this._layout);
        window.addEventListener('blur', this._releaseAll);
        document.addEventListener('visibilitychange', this._releaseAll);
        parent.append(root);
        this._layout();
    }

    /**
     * Shows the buttons while race input is on. Turning input off lets go of every button.
     */
    update(): void {
        const shown = this._input.enabled;
        if (shown === this._shown) return;
        this._shown = shown;
        this._root.style.display = shown ? '' : 'none';
        if (!shown) this._releaseAll();
    }

    /**
     * Lets go of every button and removes the overlay.
     */
    dispose(): void {
        this._releaseAll();
        window.removeEventListener('resize', this._layout);
        window.removeEventListener('blur', this._releaseAll);
        document.removeEventListener('visibilitychange', this._releaseAll);
        this._root.remove();
    }

    private _addView(button: TouchButtonLook): void {
        const view = createTouchButtonView(button);
        this._views.set(button, view);
        this._root.append(view);
    }

    private readonly _layout = (): void => {
        for (const [button, view] of this._views) {
            placeControl(view, touchButtonRect(button), window.innerWidth, window.innerHeight);
        }
    };

    private readonly _preventDefault = (e: Event): void => {
        e.preventDefault();
    };

    private readonly _onPointerDown = (e: PointerEvent): void => {
        if (!this._input.enabled) return;
        this._root.setPointerCapture(e.pointerId);
        const tapped = TAP_BUTTONS.find((b) => isOnTouchButton(b, e.clientX, e.clientY));
        this._setFinger(e.pointerId, tapped ? null : holdButtonAt(e.clientX, e.clientY, null));
        if (tapped?.command === 'reset') this._input.requestReset();
        if (tapped?.command === 'pause') this._onPause();
    };

    private readonly _onPointerMove = (e: PointerEvent): void => {
        const current = this._fingers.get(e.pointerId);
        if (current !== undefined) this._setFinger(e.pointerId, holdButtonAt(e.clientX, e.clientY, current));
    };

    private readonly _onPointerEnd = (e: PointerEvent): void => {
        if (!this._fingers.has(e.pointerId)) return;
        this._setFinger(e.pointerId, null);
        this._fingers.delete(e.pointerId);
    };

    private _setFinger(pointerId: number, button: HoldButton | null): void {
        const previous = this._fingers.get(pointerId) ?? null;
        this._fingers.set(pointerId, button);
        if (previous === button) return;
        if (previous) this._syncHold(previous);
        if (button) this._syncHold(button);
    }

    private _syncHold(button: HoldButton): void {
        const held = [...this._fingers.values()].includes(button);
        this._input.setActionHeld(button.action, held);
        const fill = button.icon === null ? 'none' : BUTTON_FILL;
        this._views.get(button)!.style.background = held ? PRESSED_FILL : fill;
    }

    private readonly _releaseAll = (): void => {
        const pressed = new Set(this._fingers.values());
        this._fingers.clear();
        for (const button of pressed) if (button) this._syncHold(button);
    };
}

/**
 * Returns the hold button at a screen point, keeping `current` while the point is within its sticky margin.
 */
function holdButtonAt(x: number, y: number, current: HoldButton | null): HoldButton | null {
    if (current && isOnTouchButton(current, x, y, STICKY_MARGIN)) return current;
    return HOLD_BUTTONS.find((b) => isOnTouchButton(b, x, y)) ?? null;
}

/**
 * Returns a picture-and-frame element for `button`, which ignores pointers until told otherwise.
 */
export function createTouchButtonView(button: TouchButtonLook): HTMLElement {
    const view = document.createElement('div');
    view.innerHTML = button.icon ?? '';
    view.setAttribute('role', 'button');
    view.setAttribute('aria-label', button.name);
    Object.assign(view.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        border: '2px solid rgba(255, 255, 255, 0.3)',
        borderRadius: '14px',
        background: button.icon === null ? 'none' : BUTTON_FILL,
        pointerEvents: 'none',
    });
    return view;
}

/**
 * Returns whether a screen point is on `button`, or within `margin` pixels of it.
 */
export function isOnTouchButton(button: TouchButtonLook, x: number, y: number, margin = 0): boolean {
    const box = controlBounds(touchButtonRect(button), window.innerWidth, window.innerHeight);
    return x >= box.x - margin && x < box.x + box.w + margin && y >= box.y - margin && y < box.y + box.h + margin;
}

/**
 * Returns where `button` goes on the current screen. Buttons shrink on a very small phone and grow with the HUD on
 * a tall screen. Ammo frames follow the HUD icons they surround.
 */
export function touchButtonRect(button: TouchButtonLook): GuiRect {
    const { rect, besideAmmo, maxHeight = Number.POSITIVE_INFINITY } = button;
    const hud = hudScale(window.innerHeight);
    if (button.icon === null) return scaleAnchoredRect(rect, hud);
    const phoneScale = Math.min(1, window.innerHeight / REFERENCE_HEIGHT);
    const scale = Math.max(MIN_TARGET_SIZE / Math.min(rect.w, rect.h), phoneScale) * hud;
    const w = rect.w * scale;
    const h = Math.min(rect.h * scale, maxHeight * hud);
    const ammoColumn = besideAmmo ? AMMO_COLUMN_WIDTH : 0;
    const rightGap = ammoColumn * hud + (DESIGN_WIDTH - rect.x - rect.w - ammoColumn) * scale;
    const x = rect.horiz === 'left' ? DESIGN_WIDTH - rightGap - w : rect.x * scale;
    const bottomGap = (DESIGN_HEIGHT - rect.y - rect.h) * scale;
    const y = rect.vert === 'top' ? DESIGN_HEIGHT - bottomGap - h : rect.y * hud;
    return { ...rect, x, y, w, h };
}
