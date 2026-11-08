/** Width of the screen the original GUIs were laid out for. */
export const DESIGN_WIDTH = 800;
/** Height of the screen the original GUIs were laid out for. */
export const DESIGN_HEIGHT = 600;

/**
 * How a Torque GUI control follows its parent when the screen size changes, per axis.
 *
 * - `right`/`bottom`: keeps its offset from the left/top edge.
 * - `left`/`top`: keeps its offset from the right/bottom edge.
 * - `center`: keeps its offset from the center.
 * - `relative`: position and size scale with the screen.
 */
export type GuiSizing = 'right' | 'left' | 'center' | 'relative' | 'bottom' | 'top';

/**
 * A control's rectangle in the 800x600 design space, with its sizing rules.
 */
export interface GuiRect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly horiz: GuiSizing;
    readonly vert: GuiSizing;
}

function axis(pos: number, size: number, design: number, actual: number, mode: GuiSizing): [number, number] {
    switch (mode) {
        case 'relative':
            return [(pos * actual) / design, (size * actual) / design];
        case 'left':
        case 'top':
            return [actual - (design - pos), size];
        case 'center':
            return [pos + (actual - design) / 2, size];
        default:
            return [pos, size];
    }
}

/** Screen height up to which the race HUD and the touch buttons keep their design size. */
const HUD_REFERENCE_HEIGHT = 768;

/**
 * Returns how much bigger the race HUD and the touch buttons draw on a screen `height` pixels tall. They never draw
 * smaller than the design.
 */
export function hudScale(height: number): number {
    return Math.max(1, height / HUD_REFERENCE_HEIGHT);
}

/**
 * Returns `rect` grown by `scale` and still anchored as it was: its distance from the edge or center it follows
 * grows too. Parts that already scale with the screen stay as they are.
 */
export function scaleAnchoredRect(rect: GuiRect, scale: number): GuiRect {
    const [x, w] = scaleAxis(rect.x, rect.w, DESIGN_WIDTH, rect.horiz, scale);
    const [y, h] = scaleAxis(rect.y, rect.h, DESIGN_HEIGHT, rect.vert, scale);
    return { ...rect, x, y, w, h };
}

function scaleAxis(pos: number, size: number, design: number, mode: GuiSizing, scale: number): [number, number] {
    switch (mode) {
        case 'relative':
            return [pos, size];
        case 'left':
        case 'top':
            return [design - (design - pos) * scale, size * scale];
        case 'center':
            return [design / 2 + (pos + size / 2 - design / 2) * scale - (size * scale) / 2, size * scale];
        default:
            return [pos * scale, size * scale];
    }
}

/**
 * Positions `element` (absolutely) for a screen of `width` x `height` pixels.
 */
export function placeControl(element: HTMLElement, rect: GuiRect, width: number, height: number): void {
    const [x, w] = axis(rect.x, rect.w, DESIGN_WIDTH, width, rect.horiz);
    const [y, h] = axis(rect.y, rect.h, DESIGN_HEIGHT, height, rect.vert);
    element.style.position = 'absolute';
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    element.style.width = `${w}px`;
    element.style.height = `${h}px`;
}

/**
 * Returns the rectangle of `rect` on a screen of `width` x `height` pixels.
 */
export function controlBounds(rect: GuiRect, width: number, height: number) {
    const [x, w] = axis(rect.x, rect.w, DESIGN_WIDTH, width, rect.horiz);
    const [y, h] = axis(rect.y, rect.h, DESIGN_HEIGHT, height, rect.vert);
    return { x, y, w, h };
}

/**
 * Returns how much bigger than the 800x600 design a menu drawn in `width` x `height` is.
 */
export function guiScale(width: number, height: number): number {
    return Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
}

/**
 * Sizes and centers `stage` as the largest 4:3 box that fits in `width` x `height`, and returns its size.
 * The menus are 800x600 pictures, so they keep their shape on wide screens instead of stretching.
 * The text inside the stage scales with it.
 */
export function fitStage(stage: HTMLElement, width: number, height: number): { w: number; h: number } {
    const scale = guiScale(width, height);
    const w = scale * DESIGN_WIDTH;
    const h = scale * DESIGN_HEIGHT;
    stage.style.setProperty('--gui-scale', String(scale));
    Object.assign(stage.style, {
        position: 'absolute',
        left: `${(width - w) / 2}px`,
        top: `${(height - h) / 2}px`,
        width: `${w}px`,
        height: `${h}px`,
    });
    return { w, h };
}
