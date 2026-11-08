import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatHud } from '../src/ui/ChatHud';

vi.mock('../src/assets/AssetPaths', () => ({ assetUrl: (path: string) => path }));

interface FakeElement {
    style: Record<string, string>;
    offsetHeight: number;
    childElementCount: number;
    append(): void;
}

describe('ChatHud scale', () => {
    let created: FakeElement[];

    beforeEach(() => {
        created = [];
        vi.stubGlobal('document', {
            createElement: () => {
                const element = { style: {}, offsetHeight: 0, childElementCount: 0, append: () => undefined };
                created.push(element);
                return element;
            },
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    const chatWith = (linesHeight: number, width: number, scale: number): ChatHud => {
        const chat = new ChatHud();
        const [, , lines] = created;
        lines.offsetHeight = linesHeight;
        chat.resize(width, scale);
        return chat;
    };

    it('sizes itself as before at the design scale', () => {
        chatWith(16, 844, 1);
        const [, window, lines] = created;
        expect(Number.parseFloat(window.style.width)).toBeCloseTo((844 * 400) / 640 - 144);
        expect(lines.style.top).toBe('1px');
    });

    it('sizes everything from the scale', () => {
        chatWith(16, 1920, 1.8);
        const [, window, lines] = created;
        expect(window.style.height).toContain('--gui-scale');
        expect(lines.style.font).toContain('--gui-scale');
        expect(lines.style.lineHeight).toContain('--gui-scale');
        expect(Number.parseFloat(window.style.width)).toBeCloseTo((1920 * 400) / 640 - 144 * 1.8);
    });

    it('keeps the margin to the window on a bigger scale', () => {
        chatWith(16, 1920, 1.8);
        expect(Number.parseFloat(created[2].style.top)).toBeCloseTo(1.8);
    });

    it('scrolls text that overflows the scaled window, keeping the newest line in view', () => {
        chatWith(200, 1920, 1.8);
        const overflow = 200 + 1.8 - 72 * 1.8;
        expect(Number.parseFloat(created[2].style.top)).toBeCloseTo(1.8 - overflow);
    });

    it('scrolls back by scaled lines', () => {
        const chat = chatWith(400, 1920, 2);
        const before = Number.parseFloat(created[2].style.top);
        chat.pageUp();
        expect(Number.parseFloat(created[2].style.top) - before).toBeCloseTo(3 * 16 * 2);
    });
});
