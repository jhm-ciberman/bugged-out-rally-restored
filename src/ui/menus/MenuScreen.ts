import { assetUrl } from '../../assets/AssetPaths';
import { bitmapButton } from '../GuiControls';
import { type GuiRect, placeControl } from '../GuiLayout';

/**
 * A rectangle that scales with the screen (`relative` sizing on both axes), in 800x600 design pixels.
 */
export const rel = (x: number, y: number, w: number, h: number): GuiRect => ({
    x,
    y,
    w,
    h,
    horiz: 'relative',
    vert: 'relative',
});

/**
 * A rectangle authored for a 640x480 screen whose controls are all `relative`, which the engine
 * scales up to the 800x600 canvas (player and venue selection, the about page).
 */
export const rel640 = (x: number, y: number, w: number, h: number): GuiRect =>
    rel(x * 1.25, y * 1.25, w * 1.25, h * 1.25);

/**
 * A full-screen menu page: a background picture with controls placed in the 800x600 design space.
 */
export class MenuScreen {
    readonly element = document.createElement('div');
    private readonly _layout: { el: HTMLElement; rect: GuiRect }[] = [];

    constructor(background: string | null) {
        Object.assign(this.element.style, {
            position: 'absolute',
            inset: '0',
            pointerEvents: 'auto',
            background: background
                ? `#000 url(${assetUrl(`client/ui/${background}`)}) center / 100% 100% no-repeat`
                : 'transparent',
            overflow: 'hidden',
            userSelect: 'none',
        });
        window.addEventListener('resize', this._onResize);
    }

    /**
     * Shows the screen inside `parent`.
     */
    show(parent: HTMLElement): void {
        parent.append(this.element);
        this._onResize();
    }

    /**
     * Removes the screen and its listeners.
     */
    dispose(): void {
        window.removeEventListener('resize', this._onResize);
        this.element.remove();
    }

    /**
     * Places `el` at `rect` and returns it.
     */
    add<T extends HTMLElement>(el: T, rect: GuiRect): T {
        this._layout.push({ el, rect });
        this.element.append(el);
        return el;
    }

    /**
     * Moves a control added with {@link add} to `rect`.
     */
    move(el: HTMLElement, rect: GuiRect): void {
        const entry = this._layout.find((e) => e.el === el);
        if (entry) entry.rect = rect;
        this._onResize();
    }

    /**
     * Adds an image button (see {@link bitmapButton}).
     */
    button(bitmap: string, rect: GuiRect, onClick: () => void, silent = false): HTMLButtonElement {
        return this.add(bitmapButton(bitmap, onClick, { silent }), rect);
    }

    /**
     * Adds a picture from `client/ui/` (or any asset path with a slash), stretched to `rect`.
     */
    image(file: string, rect: GuiRect): HTMLImageElement {
        const img = document.createElement('img');
        img.src = assetUrl(file.includes('/') ? file : `client/ui/${file}`);
        img.draggable = false;
        return this.add(img, rect);
    }

    /**
     * Adds a text line with a font profile.
     */
    text(
        text: string,
        profile: { font: string; color: string },
        rect: GuiRect,
        extra: Partial<CSSStyleDeclaration> = {},
    ): HTMLDivElement {
        const t = document.createElement('div');
        t.textContent = text;
        Object.assign(t.style, { ...profile, whiteSpace: 'pre-wrap', lineHeight: '1.15', ...extra });
        return this.add(t, rect);
    }

    /**
     * Re-lays out all controls for the current window size.
     */
    layout(): void {
        this._onResize();
    }

    private readonly _onResize = (): void => {
        const w = this.element.clientWidth || window.innerWidth;
        const h = this.element.clientHeight || window.innerHeight;
        for (const { el, rect } of this._layout) placeControl(el, rect, w, h);
    };
}
