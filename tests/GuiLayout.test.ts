import { describe, expect, it } from 'vitest';
import { arialFont, guiPx } from '../src/ui/GuiControls';
import { fitStage, type GuiRect, guiScale, hudScale, scaleAnchoredRect } from '../src/ui/GuiLayout';

function fakeStage(): { element: HTMLElement; scale: () => string | undefined } {
    const properties = new Map<string, string>();
    const style = { setProperty: (name: string, value: string) => properties.set(name, value) };
    return { element: { style } as unknown as HTMLElement, scale: () => properties.get('--gui-scale') };
}

describe('HUD scale', () => {
    it('is 1 up to 768 tall, so small screens do not change', () => {
        expect(hudScale(320)).toBe(1);
        expect(hudScale(600)).toBe(1);
        expect(hudScale(768)).toBe(1);
    });

    it('is proportional to the height above that, with no upper limit', () => {
        expect(hudScale(1080)).toBeCloseTo(1080 / 768);
        expect(hudScale(2160)).toBeCloseTo(2160 / 768);
    });

    it('scales a rect anchored to the right and bottom edges from those edges', () => {
        const rect: GuiRect = { x: 700, y: 500, w: 50, h: 40, horiz: 'left', vert: 'top' };
        const scaled = scaleAnchoredRect(rect, 2);
        expect(scaled).toEqual({ x: 600, y: 400, w: 100, h: 80, horiz: 'left', vert: 'top' });
    });

    it('scales a rect anchored to the left and top edges from those edges', () => {
        const rect: GuiRect = { x: 10, y: 20, w: 50, h: 40, horiz: 'right', vert: 'bottom' };
        expect(scaleAnchoredRect(rect, 2)).toEqual({ x: 20, y: 40, w: 100, h: 80, horiz: 'right', vert: 'bottom' });
    });

    it('grows a centered rect around the same point', () => {
        const rect: GuiRect = { x: 339, y: 170, w: 121, h: 260, horiz: 'center', vert: 'center' };
        const scaled = scaleAnchoredRect(rect, 2);
        expect(scaled.w).toBe(242);
        expect(scaled.h).toBe(520);
        expect(scaled.x + scaled.w / 2).toBe(400 + (339 + 60.5 - 400) * 2);
        expect(scaled.y + scaled.h / 2).toBe(300);
    });

    it('leaves a part that already scales with the screen alone', () => {
        const rect: GuiRect = { x: 200, y: 0, w: 200, h: 35, horiz: 'relative', vert: 'relative' };
        expect(scaleAnchoredRect(rect, 2)).toEqual(rect);
    });

    it('changes nothing at scale 1', () => {
        for (const rect of [
            { x: 725, y: 444, w: 58, h: 63, horiz: 'left', vert: 'top' },
            { x: 645, y: 5, w: 131, h: 24, horiz: 'left', vert: 'bottom' },
            { x: 339, y: 514, w: 121, h: 85, horiz: 'center', vert: 'top' },
            { x: 210, y: 170, w: 380, h: 260, horiz: 'center', vert: 'center' },
            { x: 200, y: 140, w: 400, h: 20, horiz: 'center', vert: 'relative' },
        ] as GuiRect[]) {
            expect(scaleAnchoredRect(rect, 1)).toEqual(rect);
        }
    });
});

describe('menu text scale', () => {
    it('sets the scale of a stage that fills the height of a wide screen', () => {
        const stage = fakeStage();
        expect(fitStage(stage.element, 844, 390)).toEqual({ w: 520, h: 390 });
        expect(stage.scale()).toBe('0.65');
    });

    it('sets the scale of a stage that fills the width of a tall screen', () => {
        const stage = fakeStage();
        expect(fitStage(stage.element, 400, 900)).toEqual({ w: 400, h: 300 });
        expect(stage.scale()).toBe('0.5');
    });

    it('is 1 at the size the menus were drawn for', () => {
        const stage = fakeStage();
        fitStage(stage.element, 800, 600);
        expect(stage.scale()).toBe('1');
        expect(guiScale(1600, 1200)).toBe(2);
    });

    it('builds lengths and fonts from the scale, with no change outside a menu', () => {
        expect(guiPx(22)).toBe('calc(var(--gui-scale, 1) * 22px)');
        expect(arialFont(14)).toContain('calc(var(--gui-scale, 1) * ');
        expect(arialFont(14, true).startsWith('bold calc(')).toBe(true);
    });
});
