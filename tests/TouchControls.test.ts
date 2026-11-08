import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSettings, renderPixelRatio } from '../src/game/Settings';
import { TouchControls } from '../src/input/TouchControls';
import { VehicleInput } from '../src/input/VehicleInput';

interface FakeElement extends EventTarget {
    style: Record<string, string>;
    attributes: Record<string, string>;
    innerHTML: string;
}

function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number): Event {
    return Object.assign(new Event(type, { cancelable: true }), { pointerId, clientX, clientY });
}

describe('TouchControls', () => {
    let created: FakeElement[];
    let root: FakeElement;
    let input: VehicleInput;
    let onPause: ReturnType<typeof vi.fn<() => void>>;
    let controls: TouchControls;
    let overlayParent: HTMLElement;
    let postToWindow: ReturnType<typeof vi.fn>;
    let postToParent: ReturnType<typeof vi.fn>;

    const labelled = (label: string) => created.find((e) => e.attributes['aria-label'] === label)!;
    const boxOf = (label: string) => {
        const { style } = labelled(label);
        return {
            left: Number.parseFloat(style.left),
            top: Number.parseFloat(style.top),
            width: Number.parseFloat(style.width),
            height: Number.parseFloat(style.height),
        };
    };
    const BUTTONS = [
        'Steer left',
        'Steer right',
        'Gas',
        'Brake',
        'Fire Zinger',
        'Drop Magno bomb',
        'Back on track',
        'Pause',
    ];
    const centerOf = (label: string): [number, number] => {
        const box = boxOf(label);
        return [box.left + box.width / 2, box.top + box.height / 2];
    };
    const down = (id: number, label: string) => root.dispatchEvent(pointerEvent('pointerdown', id, ...centerOf(label)));
    const moveTo = (id: number, x: number, y: number) => root.dispatchEvent(pointerEvent('pointermove', id, x, y));
    const up = (id: number) => root.dispatchEvent(pointerEvent('pointerup', id, 0, 0));
    const mount = (windowParent: unknown) => {
        controls.dispose();
        created = [];
        (window as unknown as { parent: unknown }).parent = windowParent;
        controls = new TouchControls(overlayParent, input, onPause);
    };
    const mountInIframe = () => mount({ postMessage: postToParent });

    beforeEach(() => {
        created = [];
        postToWindow = vi.fn();
        postToParent = vi.fn();
        const topWindow = Object.assign(new EventTarget(), {
            innerWidth: 844,
            innerHeight: 390,
            postMessage: postToWindow,
        });
        vi.stubGlobal('window', Object.assign(topWindow, { parent: topWindow }));
        vi.stubGlobal(
            'document',
            Object.assign(new EventTarget(), {
                pointerLockElement: null,
                hasFocus: () => true,
                createElement: () => {
                    const element = Object.assign(new EventTarget(), {
                        style: {},
                        attributes: {} as Record<string, string>,
                        innerHTML: '',
                        setAttribute(name: string, value: string) {
                            this.attributes[name] = value;
                        },
                        append: () => undefined,
                        remove: () => undefined,
                        setPointerCapture: () => undefined,
                    });
                    created.push(element);
                    return element;
                },
            }),
        );
        input = new VehicleInput(new EventTarget() as HTMLElement);
        onPause = vi.fn<() => void>();
        overlayParent = Object.assign(new EventTarget(), {
            append: (element: FakeElement) => {
                root = element;
            },
        }) as unknown as HTMLElement;
        controls = new TouchControls(overlayParent, input, onPause);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('holds the gas until the finger lifts', () => {
        down(1, 'Gas');
        expect(input.nextMove().throttle).toBe(1);
        up(1);
        expect(input.nextMove().throttle).toBe(0);
    });

    it('holds gas, steering, brake and both weapons with one finger each', () => {
        down(1, 'Gas');
        down(2, 'Steer left');
        down(3, 'Fire Zinger');
        down(4, 'Drop Magno bomb');
        down(5, 'Brake');
        const move = input.nextMove();
        expect(move.throttle).toBe(1);
        expect(move.yaw).toBeLessThan(0);
        expect(move.brake).toBe(true);
        expect(input.triggers()).toEqual({ fire: true, drop: true });
    });

    it('keeps a button held until its last finger lifts', () => {
        down(1, 'Gas');
        down(2, 'Gas');
        up(1);
        expect(input.nextMove().throttle).toBe(1);
        up(2);
        expect(input.nextMove().throttle).toBe(0);
    });

    it('releases a button when the finger slides off it', () => {
        down(1, 'Gas');
        moveTo(1, 422, 195);
        expect(input.nextMove().throttle).toBe(0);
    });

    it('keeps holding while the finger drifts just past the edge', () => {
        down(1, 'Gas');
        const [x, y] = centerOf('Gas');
        moveTo(1, x, y + 62 + 6);
        expect(input.nextMove().throttle).toBe(1);
    });

    it('moves the steering when a finger slides from left to right', () => {
        down(1, 'Steer left');
        moveTo(1, ...centerOf('Steer right'));
        expect(input.nextMove().yaw).toBeGreaterThan(0);
    });

    it('presses a button when a finger slides onto it', () => {
        root.dispatchEvent(pointerEvent('pointerdown', 1, 422, 195));
        expect(input.nextMove().throttle).toBe(0);
        moveTo(1, ...centerOf('Gas'));
        expect(input.nextMove().throttle).toBe(1);
    });

    it('releases a button when the touch is cancelled', () => {
        down(1, 'Gas');
        root.dispatchEvent(pointerEvent('pointercancel', 1, 0, 0));
        expect(input.nextMove().throttle).toBe(0);
    });

    it('releases every button when the window loses focus', () => {
        down(1, 'Gas');
        down(2, 'Fire Zinger');
        window.dispatchEvent(new Event('blur'));
        expect(input.nextMove().throttle).toBe(0);
        expect(input.triggers().fire).toBe(false);
    });

    it('releases every button when the page is hidden', () => {
        down(1, 'Gas');
        document.dispatchEvent(new Event('visibilitychange'));
        expect(input.nextMove().throttle).toBe(0);
    });

    it('ignores touches while race input is off', () => {
        input.enabled = false;
        down(1, 'Gas');
        down(2, 'Pause');
        input.enabled = true;
        expect(input.nextMove().throttle).toBe(0);
        expect(onPause).not.toHaveBeenCalled();
    });

    it('hides while race input is off and needs a new touch when it comes back', () => {
        down(1, 'Gas');
        input.enabled = false;
        controls.update();
        expect(root.style.display).toBe('none');
        input.enabled = true;
        controls.update();
        expect(root.style.display).toBe('');
        moveTo(1, ...centerOf('Gas'));
        expect(input.nextMove().throttle).toBe(0);
    });

    it('asks to put the car back on the track', () => {
        down(1, 'Back on track');
        expect(input.consumeReset()).toBe(true);
        expect(input.consumeReset()).toBe(false);
    });

    it('asks for the in-race menu', () => {
        down(1, 'Pause');
        expect(onPause).toHaveBeenCalledOnce();
    });

    it('does not run a corner button when a finger slides onto it', () => {
        root.dispatchEvent(pointerEvent('pointerdown', 1, 422, 195));
        moveTo(1, ...centerOf('Pause'));
        expect(onPause).not.toHaveBeenCalled();
    });

    it('stops scrolling, zooming and the long-press menu', () => {
        for (const type of ['touchstart', 'touchmove', 'contextmenu']) {
            const event = new Event(type, { cancelable: true });
            root.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
        }
        expect(root.style.touchAction).toBe('none');
    });

    it('has no fullscreen button of its own, framed or not', () => {
        mountInIframe();
        expect(created.some((e) => e.attributes['aria-label']?.includes('fullscreen'))).toBe(false);
        expect(postToParent).not.toHaveBeenCalled();
    });

    it('has a name on every button and no text on any', () => {
        for (const label of BUTTONS) {
            expect(labelled(label).attributes['aria-label']).toBe(label);
            expect(labelled(label).attributes.role).toBe('button');
        }
        expect(created.filter((e) => 'textContent' in e)).toHaveLength(0);
    });

    it('draws an icon on every button except the ammo frames', () => {
        for (const label of BUTTONS.filter((b) => b !== 'Fire Zinger' && b !== 'Drop Magno bomb')) {
            expect(labelled(label).innerHTML).toContain('<svg');
        }
        expect(labelled('Gas').innerHTML).toContain('fill="#fff"');
        expect(labelled('Gas').innerHTML).not.toContain('stroke');
        expect(labelled('Brake').innerHTML).not.toContain('rgb');
        expect(labelled('Fire Zinger').innerHTML).toBe('');
        expect(labelled('Drop Magno bomb').innerHTML).toBe('');
    });

    describe('screen scale', () => {
        const screenOf = (width: number, height: number) => {
            Object.assign(window, { innerWidth: width, innerHeight: height });
            mount(window);
        };

        it('keeps every button at least about a thumb wide on a small phone', () => {
            screenOf(568, 320);
            for (const label of BUTTONS) {
                const { width, height } = boxOf(label);
                expect(Math.min(width, height)).toBeGreaterThanOrEqual(56);
            }
        });

        const TALL_SCALE = 1080 / 768;

        it('keeps the phone size up to 768 tall', () => {
            for (const [width, height] of [
                [844, 390],
                [1024, 500],
                [1024, 768],
            ]) {
                screenOf(width, height);
                expect(boxOf('Gas').width).toBeCloseTo(124);
                expect(boxOf('Pause').width).toBeCloseTo(56);
            }
        });

        it('still shrinks on a very small phone', () => {
            screenOf(568, 320);
            expect(boxOf('Gas').width).toBeCloseTo((124 * 320) / 390);
        });

        it('grows every button with the HUD above 768 tall', () => {
            screenOf(1920, 1080);
            expect(boxOf('Gas').width).toBeCloseTo(124 * TALL_SCALE);
            expect(boxOf('Steer left').height).toBeCloseTo(122 * TALL_SCALE);
            expect(boxOf('Pause').width).toBeCloseTo(56 * TALL_SCALE);
        });

        it('has no upper limit', () => {
            screenOf(3840, 2160);
            expect(boxOf('Gas').width).toBeCloseTo(124 * (2160 / 768));
        });

        it('keeps the buttons anchored to their edges', () => {
            screenOf(1920, 1080);
            const steer = boxOf('Steer left');
            const gas = boxOf('Gas');
            expect(steer.left).toBeCloseTo(12 * TALL_SCALE);
            expect(steer.top + steer.height).toBeCloseTo(1080 - 10 * TALL_SCALE);
            expect(gas.top + gas.height).toBeCloseTo(1080 - 10 * TALL_SCALE);
        });

        it('keeps the top row below the HUD text as the HUD grows', () => {
            screenOf(1920, 1080);
            expect(boxOf('Pause').top).toBeCloseTo(60 * TALL_SCALE);
            expect(boxOf('Back on track').height).toBeCloseTo(56 * TALL_SCALE);
            expect(boxOf('Back on track').top + boxOf('Back on track').height).toBeLessThan(58 * TALL_SCALE);
        });

        it('leaves the ammo frames alone up to 768 tall', () => {
            const frame = boxOf('Fire Zinger');
            screenOf(1024, 768);
            const same = boxOf('Fire Zinger');
            expect([same.width, same.height]).toEqual([frame.width, frame.height]);
            expect(1024 - same.left).toBe(844 - frame.left);
            expect(768 - same.top).toBe(390 - frame.top);
        });

        it('grows the ammo frames with the HUD on a taller screen', () => {
            screenOf(1920, 1080);
            const big = boxOf('Fire Zinger');
            expect(big.width).toBeCloseTo(78 * TALL_SCALE);
            expect(big.height).toBeCloseTo(74 * TALL_SCALE);
            expect(1920 - big.left - big.width).toBeCloseTo(5 * TALL_SCALE);
            expect(1080 - big.top - big.height).toBeCloseTo(86 * TALL_SCALE);
        });

        it('keeps the gas and brake clear of the ammo frames on every screen', () => {
            for (const [width, height] of [
                [568, 320],
                [667, 375],
                [844, 390],
                [1024, 768],
                [1920, 1080],
            ]) {
                screenOf(width, height);
                const frameLeft = boxOf('Fire Zinger').left;
                for (const label of ['Gas', 'Brake']) {
                    const box = boxOf(label);
                    expect(box.left + box.width).toBeLessThanOrEqual(frameLeft);
                }
            }
        });

        it('hit-tests where the button is drawn after scaling', () => {
            screenOf(1920, 1080);
            const { left, top } = boxOf('Gas');
            root.dispatchEvent(pointerEvent('pointerdown', 1, left + 4, top + 4));
            expect(input.nextMove().throttle).toBe(1);
        });

        it('moves the buttons when the screen changes', () => {
            const before = boxOf('Gas');
            Object.assign(window, { innerWidth: 1920, innerHeight: 1080 });
            window.dispatchEvent(new Event('resize'));
            expect(boxOf('Gas').width).toBeGreaterThan(before.width);
        });
    });

    it('lets go of every button when disposed', () => {
        down(1, 'Gas');
        controls.dispose();
        expect(input.nextMove().throttle).toBe(0);
    });
});

describe('render quality with ?touch', () => {
    afterEach(() => vi.unstubAllGlobals());

    function stubScreen(search: string): void {
        vi.stubGlobal('window', { location: { search }, devicePixelRatio: 2 });
    }

    it('renders at low quality without changing the saved setting', () => {
        stubScreen('?touch&track=1');
        expect(renderPixelRatio()).toBe(1);
        expect(getSettings().renderQuality).toBe('high');
    });

    it('keeps the saved quality without the parameter', () => {
        stubScreen('?track=1');
        expect(renderPixelRatio()).toBe(2);
    });
});
