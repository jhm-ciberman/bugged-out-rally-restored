import { assetUrl } from '../assets/AssetPaths';

/**
 * Creates a Torque `GuiBitmapButtonCtrl`: an image button whose art swaps between the
 * `_n` (normal), `_h` (hover), `_d` (pressed) and `_i` (disabled) versions of `bitmap`.
 *
 * @param bitmap Path under `client/ui/` without the state suffix, such as `quit` or `buttons/left`.
 */
export function bitmapButton(bitmap: string, onClick: () => void): HTMLButtonElement {
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
    button.addEventListener('mouseenter', () => set('h'));
    button.addEventListener('mouseleave', () => set('n'));
    button.addEventListener('mousedown', () => set('d'));
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
