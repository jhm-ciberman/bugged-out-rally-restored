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
    preloadButtonArt(bitmap);
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

/** Decoded button pictures, kept alive so the browser does not drop them. */
const preloaded = new Map<string, HTMLImageElement>();

/**
 * Loads and decodes every state picture of a button up front, so the first hover or press
 * swaps the art without a blank frame.
 */
function preloadButtonArt(bitmap: string): void {
    for (const state of ['n', 'h', 'd', 'i']) {
        const url = assetUrl(`client/ui/${bitmap}_${state}.png`);
        if (preloaded.has(url)) continue;
        const img = new Image();
        img.src = url;
        // Some buttons ship without every state; a missing picture is fine.
        img.decode().catch(() => undefined);
        preloaded.set(url, img);
    }
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

/** `GuiSliderCtrl` geometry in design pixels: thumb size and the line's inset (`mThumbSize`, `mShiftPoint`). */
const SLIDER = { thumbW: 8, thumbH: 20, shift: 5, shiftExtent: 10, tick: 5 };

/**
 * A Torque slider with `GuiSafariSliderProfile` (`GuiSliderCtrl::onRender`): a white rule with tick marks, a
 * raised orange thumb and the value printed under it. Fills its parent; `width` and `height` are its size in
 * design pixels, which sets the proportions.
 */
export function safariSlider(
    width: number,
    height: number,
    range: readonly [number, number],
    ticks: number,
    value: number,
    onInput: (value: number) => void,
): HTMLDivElement {
    const root = document.createElement('div');
    Object.assign(root.style, { position: 'relative', cursor: 'pointer', touchAction: 'none' });
    const pct = (x: number, total: number) => `${(x / total) * 100}%`;
    const ext = width - SLIDER.shiftExtent;
    const midY = SLIDER.thumbH / 2;

    const rule = document.createElement('div');
    Object.assign(rule.style, {
        position: 'absolute',
        left: pct(SLIDER.shift, width),
        width: pct(ext, width),
        top: pct(midY, height),
        height: '1px',
        background: '#fff',
    });
    root.append(rule);
    for (let t = 0; t <= ticks + 1; t++) {
        const mark = document.createElement('div');
        Object.assign(mark.style, {
            position: 'absolute',
            left: pct(SLIDER.shift + ((ext - 1) / (ticks + 1)) * t, width),
            top: pct(midY - SLIDER.tick, height),
            height: pct(SLIDER.tick * 2, height),
            width: '1px',
            background: '#fff',
        });
        root.append(mark);
    }
    // renderRaisedBox: fill, white top-left bevel, black bottom-right, then the profile's border inside it.
    const thumb = document.createElement('div');
    Object.assign(thumb.style, {
        position: 'absolute',
        top: '0',
        width: pct(SLIDER.thumbW, width),
        height: pct(SLIDER.thumbH, height),
        boxSizing: 'border-box',
        background: 'rgb(255, 192, 55)',
        borderTop: '1px solid #fff',
        borderLeft: '1px solid #fff',
        borderRight: '1px solid #000',
        borderBottom: '1px solid #000',
        boxShadow: 'inset -1px -1px 0 rgb(202, 141, 49)',
    });
    const label = document.createElement('div');
    Object.assign(label.style, {
        position: 'absolute',
        top: pct(SLIDER.thumbH - 2, height),
        font: '12px Arial, sans-serif',
        color: '#fff',
        transform: 'translateX(-50%)',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
    });
    root.append(thumb, label);

    const [min, max] = range;
    const set = (v: number, notify: boolean) => {
        const clamped = Math.min(max, Math.max(min, v));
        // updateThumb: the thumb centre travels over the width less half the thumb and the shift.
        const mx = (width - (SLIDER.shiftExtent + SLIDER.thumbW) / 2) * ((clamped - min) / (max - min));
        thumb.style.left = pct(SLIDER.shift + mx - SLIDER.thumbW / 2, width);
        label.style.left = pct(SLIDER.shift + mx, width);
        label.textContent = clamped.toFixed(3);
        if (notify) onInput(clamped);
    };
    const fromPointer = (e: PointerEvent) => {
        const box = root.getBoundingClientRect();
        const x = ((e.clientX - box.left) / box.width) * width;
        set(min + ((x - SLIDER.shift) / (width - (SLIDER.shiftExtent + SLIDER.thumbW) / 2)) * (max - min), true);
    };
    root.addEventListener('pointerdown', (e) => {
        root.setPointerCapture(e.pointerId);
        fromPointer(e);
    });
    root.addEventListener('pointermove', (e) => {
        if (root.hasPointerCapture(e.pointerId)) fromPointer(e);
    });
    set(value, false);
    return root;
}

/** Height of the sprite `safcheck.png` and of one of its cells, below a 1 px red separator. */
const CHECK_SPRITE = { height: 66, cell: 15, stride: 16 };

/**
 * Draws a checkbox with the game's own art (`GuiCheckBoxProfile`, `safcheck.png`): off or on, and the pressed
 * look while the mouse button is down (`GuiCheckBoxCtrl::onRender`). Keeps working as a normal checkbox.
 */
export function styleTorqueCheckbox(box: HTMLInputElement): void {
    let pressed = false;
    const paint = () => {
        const index = (box.checked ? 1 : 0) + (pressed ? 2 : 0);
        const top = 1 + CHECK_SPRITE.stride * index;
        // A percentage moves the image by (box - image), which is negative here.
        box.style.backgroundPositionY = `${(top / (CHECK_SPRITE.height - CHECK_SPRITE.cell)) * 100}%`;
    };
    Object.assign(box.style, {
        appearance: 'none',
        margin: '0',
        cursor: 'pointer',
        backgroundImage: `url(${assetUrl('client/ui/safcheck.png')})`,
        backgroundSize: `100% ${(CHECK_SPRITE.height / CHECK_SPRITE.cell) * 100}%`,
        imageRendering: 'pixelated',
    });
    box.addEventListener('pointerdown', () => {
        pressed = true;
        paint();
    });
    box.addEventListener('pointerup', () => {
        pressed = false;
        paint();
    });
    box.addEventListener('pointerleave', () => {
        pressed = false;
        paint();
    });
    box.addEventListener('change', paint);
    paint();
}
