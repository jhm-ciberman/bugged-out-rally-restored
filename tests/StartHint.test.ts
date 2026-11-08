import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartHint } from '../src/ui/menus/StartHint';

vi.mock('../src/assets/AssetPaths', () => ({ assetUrl: (path: string) => path }));

describe('StartHint', () => {
    let animate: ReturnType<typeof vi.fn>;
    let properties: Map<string, string>;

    function hintOn(search: string, reducedMotion = false, width = 1600, height = 1200): StartHint {
        animate = vi.fn();
        properties = new Map();
        const page = Object.assign(new EventTarget(), {
            innerWidth: width,
            innerHeight: height,
            location: { search },
            matchMedia: () => ({ matches: reducedMotion }),
        });
        vi.stubGlobal('window', page);
        vi.stubGlobal('document', {
            createElement: () => ({
                style: { setProperty: (name: string, value: string) => properties.set(name, value) },
                textContent: '',
                animate,
            }),
        });
        return new StartHint();
    }

    afterEach(() => vi.unstubAllGlobals());

    it('says to click with a keyboard and mouse', () => {
        expect(hintOn('').element.textContent).toBe('Click to start');
    });

    it('says to tap in touch mode', () => {
        expect(hintOn('?touch').element.textContent).toBe('Tap to start');
    });

    it('lets the click through to the splash', () => {
        expect(hintOn('').element.style.pointerEvents).toBe('none');
    });

    it('uses the game font in the menu gold', () => {
        const { style } = hintOn('').element;
        expect(style.font).toContain('Arial');
        expect(style.font).toContain('bold');
        expect(style.color).toBe('rgb(255, 215, 0)');
    });

    it('blinks forever', () => {
        hintOn('');
        expect(animate).toHaveBeenCalledOnce();
        expect(animate.mock.calls[0][1].iterations).toBe(Number.POSITIVE_INFINITY);
    });

    it('does not blink when the player asks for reduced motion', () => {
        hintOn('', true);
        expect(animate).not.toHaveBeenCalled();
    });

    it('scales with the screen', () => {
        hintOn('');
        expect(properties.get('--gui-scale')).toBe('2');
        Object.assign(window, { innerWidth: 400, innerHeight: 300 });
        window.dispatchEvent(new Event('resize'));
        expect(properties.get('--gui-scale')).toBe('0.5');
    });

    it('stops following the screen when disposed', () => {
        const hint = hintOn('');
        hint.dispose();
        Object.assign(window, { innerWidth: 400, innerHeight: 300 });
        window.dispatchEvent(new Event('resize'));
        expect(properties.get('--gui-scale')).toBe('2');
    });
});
