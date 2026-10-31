import { assetUrl } from '../../assets/AssetPaths';
import { bitmapButton } from '../GuiControls';
import { fitStage, type GuiRect, placeControl } from '../GuiLayout';

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
 *
 * The page is drawn in a centered 4:3 area; on wider screens the sides stay black (or show the race,
 * for pages without a background).
 */
export class MenuScreen {
    readonly element = document.createElement('div');
    /** The 4:3 area that holds the background and the controls. */
    private readonly _stage = document.createElement('div');
    private readonly _layout: { el: HTMLElement; rect: GuiRect }[] = [];

    constructor(background: string | null) {
        Object.assign(this.element.style, {
            position: 'absolute',
            inset: '0',
            pointerEvents: 'auto',
            background: background ? '#000' : 'transparent',
            overflow: 'hidden',
            userSelect: 'none',
        });
        if (background) {
            this._stage.style.background = `url(${assetUrl(`client/ui/${background}`)}) center / 100% 100% no-repeat`;
        }
        this.element.append(this._stage);
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
        this._stage.append(el);
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
     * Adds text laid out between margins given in percent of the control's own width, like the
     * `<lmargin%:5><rmargin%:105>` markup of the original GUIs. Returns the element holding the text.
     */
    marginText(
        text: string,
        profile: { font: string; color: string },
        rect: GuiRect,
        leftPercent = 5,
        rightPercent = 105,
    ): HTMLDivElement {
        const box = this.add(document.createElement('div'), rect);
        const inner = document.createElement('div');
        inner.textContent = text;
        Object.assign(inner.style, {
            ...profile,
            position: 'absolute',
            top: '0',
            left: `${leftPercent}%`,
            width: `${rightPercent - leftPercent}%`,
            whiteSpace: 'pre-wrap',
            lineHeight: '1.15',
        });
        box.append(inner);
        return inner;
    }

    /**
     * Re-lays out all controls for the current window size.
     */
    layout(): void {
        this._onResize();
    }

    private readonly _onResize = (): void => {
        const { w, h } = fitStage(
            this._stage,
            this.element.clientWidth || window.innerWidth,
            this.element.clientHeight || window.innerHeight,
        );
        for (const { el, rect } of this._layout) placeControl(el, rect, w, h);
    };
}
