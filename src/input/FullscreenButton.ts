import { placeControl } from '../ui/GuiLayout';
import { togglePageFullscreen, watchPageFullscreen } from '../ui/PageFullscreen';
import {
    createTouchButtonView,
    isOnTouchButton,
    STICKY_MARGIN,
    type TouchButtonLook,
    touchButtonRect,
    touchIcon,
} from './TouchControls';

const ENTER_ICON = touchIcon('M3 9V3h6v2.5H5.5V9zM15 3h6v6h-2.5V5.5H15zM21 15v6h-6v-2.5h3.5V15zM9 21H3v-6h2.5v3.5H9z');
const EXIT_ICON = touchIcon('M9 3v6H3V6.5h3.5V3zM21 9h-6V3h2.5v3.5H21zM15 21v-6h6v2.5h-3.5V21zM3 15h6v6H6.5v-3.5H3z');

/** Sits beside the race overlay's pause button. */
const BUTTON: TouchButtonLook = {
    name: 'Enter fullscreen',
    icon: ENTER_ICON,
    rect: { x: 698, y: 60, w: 44, h: 44, horiz: 'left', vert: 'bottom' },
};

/**
 * The button that enters or leaves the full-page mode of the page around the game. It stays above every screen
 * and shows the state the page reports.
 */
export class FullscreenButton {
    private readonly _view = createTouchButtonView(BUTTON);
    private readonly _stopWatching: () => void;
    /** The finger that came down on the button and has not lifted. */
    private _pointerId: number | null = null;

    constructor(parent: HTMLElement) {
        const view = this._view;
        // Above the menus (`main.ts`) and their message box, which stacks inside them.
        Object.assign(view.style, {
            zIndex: '20',
            pointerEvents: 'auto',
            touchAction: 'none',
            userSelect: 'none',
            webkitUserSelect: 'none',
            webkitTouchCallout: 'none',
        });
        view.addEventListener('pointerdown', this._onPointerDown);
        view.addEventListener('pointerup', this._onPointerUp);
        view.addEventListener('pointercancel', this._forgetPointer);
        view.addEventListener('contextmenu', this._preventDefault);
        view.addEventListener('touchstart', this._preventDefault, { passive: false });
        view.addEventListener('touchmove', this._preventDefault, { passive: false });
        window.addEventListener('resize', this._layout);
        window.addEventListener('blur', this._forgetPointer);
        document.addEventListener('visibilitychange', this._forgetPointer);
        parent.append(view);
        this._layout();
        this._stopWatching = watchPageFullscreen(this._showState);
    }

    /**
     * Removes the button and stops following the page's state.
     */
    dispose(): void {
        this._stopWatching();
        window.removeEventListener('resize', this._layout);
        window.removeEventListener('blur', this._forgetPointer);
        document.removeEventListener('visibilitychange', this._forgetPointer);
        this._view.remove();
    }

    private readonly _layout = (): void => {
        placeControl(this._view, touchButtonRect(BUTTON), window.innerWidth, window.innerHeight);
    };

    private readonly _preventDefault = (e: Event): void => {
        e.preventDefault();
    };

    private readonly _showState = (filled: boolean): void => {
        this._view.innerHTML = filled ? EXIT_ICON : ENTER_ICON;
        this._view.setAttribute('aria-label', filled ? 'Exit fullscreen' : BUTTON.name);
    };

    private readonly _onPointerDown = (e: PointerEvent): void => {
        this._view.setPointerCapture(e.pointerId);
        this._pointerId = e.pointerId;
    };

    private readonly _onPointerUp = (e: PointerEvent): void => {
        if (e.pointerId !== this._pointerId) return;
        this._pointerId = null;
        if (isOnTouchButton(BUTTON, e.clientX, e.clientY, STICKY_MARGIN)) togglePageFullscreen();
    };

    private readonly _forgetPointer = (): void => {
        this._pointerId = null;
    };
}
