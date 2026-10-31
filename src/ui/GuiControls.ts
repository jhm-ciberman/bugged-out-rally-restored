import { assetUrl } from '../assets/AssetPaths';

/**
 * The sounds of `GuiButtonProfile` buttons (`AudioButtonOver`, `AudioButtonDown`). Set once at startup.
 */
export const buttonSounds: { over: (() => void) | null; down: (() => void) | null } = { over: null, down: null };

/**
 * Creates a Torque `GuiBitmapButtonCtrl`: an image button whose art swaps between the
 * `_n` (normal), `_h` (hover), `_d` (pressed) and `_i` (disabled) versions of `bitmap`.
 *
 * Buttons play the hover and press sounds of {@link buttonSounds} unless `silent` (controls on
 * `GuiDefaultProfile` in the original have no sounds).
 *
 * @param bitmap Path under `client/ui/` without the state suffix, such as `quit` or `buttons/left`.
 */
export function bitmapButton(
    bitmap: string,
    onClick: () => void,
    options: { silent?: boolean } = {},
): HTMLButtonElement {
    const button = document.createElement('button');
    const art = (state: string) => `url(${assetUrl(`client/ui/${bitmap}_${state}.png`)})`;
    Object.assign(button.style, {
        background: `${art('n')} center / 100% 100% no-repeat`,
        border: 'none',
        padding: '0',
        cursor: 'pointer',
        pointerEvents: 'auto',
    });
    const set = (state: string) => {
        button.style.backgroundImage = art(button.disabled ? 'i' : state);
    };
    button.addEventListener('mouseenter', () => {
        set('h');
        if (!options.silent && !button.disabled) buttonSounds.over?.();
    });
    button.addEventListener('mouseleave', () => set('n'));
    button.addEventListener('mousedown', () => {
        set('d');
        if (!options.silent && !button.disabled) buttonSounds.down?.();
    });
    button.addEventListener('mouseup', () => set('h'));
    button.addEventListener('click', () => {
        if (!button.disabled) onClick();
    });
    return button;
}

/**
 * Sets a button enabled or disabled, updating its art.
 */
export function setButtonEnabled(button: HTMLButtonElement, enabled: boolean, bitmap: string): void {
    button.disabled = !enabled;
    button.style.cursor = enabled ? 'pointer' : 'default';
    button.style.backgroundImage = `url(${assetUrl(`client/ui/${bitmap}_${enabled ? 'n' : 'i'}.png`)})`;
}

/** Arial Bold 24, gold (`GuiMediumTextProfile`). */
export const MEDIUM_TEXT = { font: 'bold 24px Arial, sans-serif', color: 'rgb(255, 215, 0)' };
/** Arial Bold 18, white (`GuiSafariMediumTextProfile`). */
export const SAFARI_MEDIUM_TEXT = { font: 'bold 18px Arial, sans-serif', color: '#fff' };

/** Arial Bold 24, red (`GuiMediumRedTextProfile`). */
export const MEDIUM_RED_TEXT = { font: 'bold 24px Arial, sans-serif', color: 'rgb(215, 14, 48)' };
/** Arial Bold 16, orange (`GuiAboutTextProfile` with its inline font). */
export const ABOUT_TEXT = { font: 'bold 16px Arial, sans-serif', color: 'rgb(255, 162, 0)' };
/** Arial Bold 24, white (`GuiSafariTextArrayProfile`). */
export const SAFARI_ARRAY_TEXT = { font: 'bold 24px Arial, sans-serif', color: '#fff' };
/** A 1 px black drop shadow (`<shadowcolor:000000><shadow:1:1>`). */
export const SHADOW = '1px 1px 0 #000';
