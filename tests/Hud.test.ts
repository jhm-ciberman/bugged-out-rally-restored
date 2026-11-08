import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hud } from '../src/ui/Hud';

vi.mock('../src/assets/AssetPaths', () => ({ assetUrl: (path: string) => path }));

interface FakeElement {
    style: Record<string, string> & { setProperty(name: string, value: string): void };
    src: string;
    textContent: string;
    offsetHeight: number;
    append(...children: FakeElement[]): void;
}

function fakeElement(): FakeElement {
    const style = {
        setProperty(name: string, value: string) {
            (style as Record<string, unknown>)[name] = value;
        },
    };
    return {
        style: style as FakeElement['style'],
        src: '',
        textContent: '',
        offsetHeight: 0,
        append: () => undefined,
    };
}

const TALL = 1080 / 768;

describe('Hud scale', () => {
    let created: FakeElement[];

    function hudOn(width: number, height: number): Hud {
        created = [];
        vi.stubGlobal('window', { innerWidth: width, innerHeight: height });
        vi.stubGlobal('document', {
            createElement: () => {
                const element = fakeElement();
                created.push(element);
                return element;
            },
        });
        return new Hud(fakeElement() as unknown as HTMLElement);
    }

    const box = (element: FakeElement) => ({
        left: Number.parseFloat(element.style.left),
        top: Number.parseFloat(element.style.top),
        width: Number.parseFloat(element.style.width),
        height: Number.parseFloat(element.style.height),
    });
    const icon = (file: string) => created.find((e) => e.src.includes(file))!;
    const speedometer = () => created.find((e) => e.style.background?.includes('speedometer'))!;
    /** The text parts in creation order: `lapPos`, `lapTime`, `zingCount`, `bombCount`. */
    const textParts = () => created.filter((e) => e.style.textShadow !== undefined && e.style.whiteSpace === 'pre');
    const hudRoot = (hud: Hud) => hud.element as unknown as FakeElement;

    afterEach(() => vi.unstubAllGlobals());

    it('sets the scale for its text and parts', () => {
        expect(hudRoot(hudOn(1920, 1080)).style['--gui-scale']).toBe(String(TALL));
    });

    it('stays at the design scale on a phone and up to 768 tall', () => {
        expect(hudRoot(hudOn(844, 390)).style['--gui-scale']).toBe('1');
        expect(hudRoot(hudOn(800, 600)).style['--gui-scale']).toBe('1');
        expect(hudRoot(hudOn(1024, 768)).style['--gui-scale']).toBe('1');
    });

    it('keeps every fixed part exactly in place on a phone', () => {
        hudOn(844, 390);
        expect(box(icon('zingergui.png'))).toEqual({ left: 769, top: 234, width: 58, height: 63 });
        expect(box(icon('bombicon.png'))).toEqual({ left: 769, top: 307, width: 60, height: 63 });
        expect(box(speedometer())).toEqual({ left: 361, top: 304, width: 121, height: 85 });
        const [lapPos, lapTime] = textParts();
        expect(box(lapPos)).toEqual({ left: 689, top: 5, width: 131, height: 24 });
        expect(box(lapTime)).toEqual({ left: 689, top: 32, width: 127, height: 24 });
    });

    it('grows the ammo icons from their corner', () => {
        hudOn(1920, 1080);
        const zinger = box(icon('zingergui.png'));
        expect(zinger.width).toBeCloseTo(58 * TALL);
        expect(zinger.height).toBeCloseTo(63 * TALL);
        expect(1920 - zinger.left).toBeCloseTo(75 * TALL);
        expect(1080 - zinger.top).toBeCloseTo(156 * TALL);
    });

    it('grows the ammo counts and the lap text from their corner', () => {
        hudOn(1920, 1080);
        const [lapPos, lapTime, zingCount] = textParts();
        expect(box(lapPos).height).toBeCloseTo(24 * TALL);
        expect(1920 - box(lapPos).left).toBeCloseTo(155 * TALL);
        expect(box(lapPos).top).toBeCloseTo(5 * TALL);
        expect(box(lapTime).top).toBeCloseTo(32 * TALL);
        expect(box(zingCount).height).toBeCloseTo(24 * TALL);
        expect(1080 - box(zingCount).top).toBeCloseTo(111 * TALL);
    });

    it('grows the speedometer from the bottom center', () => {
        hudOn(1920, 1080);
        const speedo = box(speedometer());
        expect(speedo.width).toBeCloseTo(121 * TALL);
        expect(speedo.height).toBeCloseTo(85 * TALL);
        expect(1080 - speedo.top).toBeCloseTo(86 * TALL);
        expect(speedo.left + speedo.width / 2).toBeCloseTo(960 + (339 + 60.5 - 400) * TALL);
    });

    it('sizes the needle and the text from the scale', () => {
        hudOn(1920, 1080);
        const needle = created.find((e) => e.style.transformOrigin !== undefined)!;
        expect(needle.style.left).toContain('--gui-scale');
        expect(needle.style.width).toContain('--gui-scale');
        expect(needle.style.transformOrigin).toContain('--gui-scale');
        for (const part of textParts()) {
            expect(part.style.font).toContain('--gui-scale');
            expect(part.style.lineHeight).toContain('--gui-scale');
        }
    });

    it('leaves the health and energy bars to the screen size', () => {
        hudOn(1920, 1080);
        const health = created.find((e) => e.style.background === 'rgba(0, 0, 0, 0.5)')!;
        expect(box(health)).toEqual({ left: 480, top: 0, width: 480, height: 63 });
    });

    it('grows again on a resize', () => {
        const hud = hudOn(844, 390);
        hud.resize(1920, 1080);
        expect(hudRoot(hud).style['--gui-scale']).toBe(String(TALL));
        expect(box(icon('zingergui.png')).width).toBeCloseTo(58 * TALL);
    });
});
