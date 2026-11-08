import { touchControlsEnabled } from '../../game/Settings';
import { arialFont, guiPx, MEDIUM_TEXT } from '../GuiControls';
import { guiScale } from '../GuiLayout';

/** Milliseconds of one fade of the blink. */
const BLINK_MS = 900;

/**
 * The line near the bottom of the splash screen that says how to start. It lets pointers through to the splash.
 */
export class StartHint {
    readonly element = document.createElement('div');

    constructor() {
        const e = this.element;
        e.textContent = touchControlsEnabled() ? 'Tap to start' : 'Click to start';
        Object.assign(e.style, {
            position: 'absolute',
            left: '0',
            right: '0',
            // The splash picture's logo reaches almost to the bottom edge.
            bottom: '1%',
            font: arialFont(28, true),
            color: MEDIUM_TEXT.color,
            textAlign: 'center',
            textShadow: `${guiPx(2)} ${guiPx(2)} 0 #000`,
            pointerEvents: 'none',
            userSelect: 'none',
        });
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            e.animate([{ opacity: 1 }, { opacity: 0.4 }], {
                duration: BLINK_MS,
                direction: 'alternate',
                easing: 'ease-in-out',
                iterations: Number.POSITIVE_INFINITY,
            });
        }
        window.addEventListener('resize', this._fitToScreen);
        this._fitToScreen();
    }

    /**
     * Stops following the screen size.
     */
    dispose(): void {
        window.removeEventListener('resize', this._fitToScreen);
    }

    private readonly _fitToScreen = (): void => {
        this.element.style.setProperty('--gui-scale', String(guiScale(window.innerWidth, window.innerHeight)));
    };
}
