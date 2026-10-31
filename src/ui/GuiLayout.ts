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
 * Sizes and centers `stage` as the largest 4:3 box that fits in `width` x `height`, and returns its size.
 * The menus are 800x600 pictures, so they keep their shape on wide screens instead of stretching.
 */
export function fitStage(stage: HTMLElement, width: number, height: number): { w: number; h: number } {
    const w = Math.min(width, (height * DESIGN_WIDTH) / DESIGN_HEIGHT);
    const h = (w * DESIGN_HEIGHT) / DESIGN_WIDTH;
    Object.assign(stage.style, {
        position: 'absolute',
        left: `${(width - w) / 2}px`,
        top: `${(height - h) / 2}px`,
        width: `${w}px`,
        height: `${h}px`,
    });
    return { w, h };
}
