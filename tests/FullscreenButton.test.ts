import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FullscreenButton } from '../src/input/FullscreenButton';

interface FakeElement extends EventTarget {
    style: Record<string, string>;
    attributes: Record<string, string>;
    innerHTML: string;
}

const TOGGLE = { type: 'bugged-out-rally:toggle-fullscreen' };
const STATE_TYPE = 'bugged-out-rally:fullscreen-state';

function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number): Event {
    return Object.assign(new Event(type, { cancelable: true }), { pointerId, clientX, clientY });
}

describe('FullscreenButton', () => {
    let created: FakeElement[];
    let view: FakeElement;
    let postToParent: ReturnType<typeof vi.fn>;
    let button: FullscreenButton;

    const toggles = () => postToParent.mock.calls.filter(([message]) => message.type === TOGGLE.type);
    const center = (): [number, number] => [
        Number.parseFloat(view.style.left) + Number.parseFloat(view.style.width) / 2,
        Number.parseFloat(view.style.top) + Number.parseFloat(view.style.height) / 2,
    ];
    const down = () => view.dispatchEvent(pointerEvent('pointerdown', 1, ...center()));
    const up = () => view.dispatchEvent(pointerEvent('pointerup', 1, ...center()));
    const sendState = (source: unknown, data: unknown) =>
        window.dispatchEvent(Object.assign(new Event('message'), { source, data }));

    beforeEach(() => {
        created = [];
        postToParent = vi.fn();
        vi.stubGlobal(
            'window',
            Object.assign(new EventTarget(), {
                innerWidth: 844,
                innerHeight: 390,
                parent: { postMessage: postToParent },
            }),
        );
        vi.stubGlobal(
            'document',
            Object.assign(new EventTarget(), {
                createElement: () => {
                    const element = Object.assign(new EventTarget(), {
                        style: {},
                        attributes: {} as Record<string, string>,
                        innerHTML: '',
                        setAttribute(name: string, value: string) {
                            this.attributes[name] = value;
                        },
                        remove: () => undefined,
                        setPointerCapture: () => undefined,
                    });
                    created.push(element);
                    return element;
                },
            }),
        );
        button = new FullscreenButton(Object.assign(new EventTarget(), { append: () => undefined }) as never);
        view = created[0];
    });
    afterEach(() => vi.unstubAllGlobals());

    it('takes touches above the menus', () => {
        expect(view.style.pointerEvents).toBe('auto');
        expect(Number(view.style.zIndex)).toBeGreaterThan(10);
        expect(view.style.touchAction).toBe('none');
    });

    it('has a name and an icon', () => {
        expect(view.attributes['aria-label']).toBe('Enter fullscreen');
        expect(view.innerHTML).toContain('<svg');
    });

    it('is at least a thumb wide on a small phone', () => {
        Object.assign(window, { innerWidth: 568, innerHeight: 320 });
        window.dispatchEvent(new Event('resize'));
        expect(Number.parseFloat(view.style.width)).toBeGreaterThanOrEqual(56);
        expect(Number.parseFloat(view.style.height)).toBeGreaterThanOrEqual(56);
    });

    it('keeps its size up to 768 tall', () => {
        Object.assign(window, { innerWidth: 1024, innerHeight: 768 });
        window.dispatchEvent(new Event('resize'));
        expect(Number.parseFloat(view.style.width)).toBeCloseTo(56);
    });

    it('grows with the HUD above 768 tall', () => {
        Object.assign(window, { innerWidth: 1920, innerHeight: 1080 });
        window.dispatchEvent(new Event('resize'));
        expect(Number.parseFloat(view.style.width)).toBeCloseTo((56 * 1080) / 768);
    });

    it('draws a plain white icon', () => {
        expect(view.innerHTML).toContain('fill="#fff"');
        expect(view.innerHTML).not.toContain('stroke');
    });

    it('asks for the fullscreen state once when created', () => {
        expect(postToParent.mock.calls).toEqual([[{ type: 'bugged-out-rally:request-fullscreen-state' }, '*']]);
    });

    it('asks the page to toggle fullscreen once per tap', () => {
        down();
        up();
        expect(toggles()).toEqual([[TOGGLE, '*']]);
        down();
        up();
        expect(toggles()).toHaveLength(2);
    });

    it('waits for the release', () => {
        down();
        expect(toggles()).toHaveLength(0);
    });

    it('does not toggle when the finger slides away first', () => {
        down();
        view.dispatchEvent(pointerEvent('pointerup', 1, 422, 195));
        expect(toggles()).toHaveLength(0);
    });

    it('does not toggle when the touch is cancelled', () => {
        down();
        view.dispatchEvent(pointerEvent('pointercancel', 1, ...center()));
        up();
        expect(toggles()).toHaveLength(0);
    });

    it('does not toggle after the window loses focus', () => {
        down();
        window.dispatchEvent(new Event('blur'));
        up();
        expect(toggles()).toHaveLength(0);
    });

    it('does not toggle after the page is hidden', () => {
        down();
        document.dispatchEvent(new Event('visibilitychange'));
        up();
        expect(toggles()).toHaveLength(0);
    });

    it('does not toggle on a release that never started on the button', () => {
        up();
        expect(toggles()).toHaveLength(0);
    });

    it('shows the state the page reports', () => {
        const enterIcon = view.innerHTML;
        sendState(window.parent, { type: STATE_TYPE, filled: true });
        expect(view.attributes['aria-label']).toBe('Exit fullscreen');
        expect(view.innerHTML).not.toBe(enterIcon);
        expect(view.innerHTML).toContain('<svg');
        sendState(window.parent, { type: STATE_TYPE, filled: false });
        expect(view.attributes['aria-label']).toBe('Enter fullscreen');
        expect(view.innerHTML).toBe(enterIcon);
    });

    it('keeps working after the state changes its name', () => {
        sendState(window.parent, { type: STATE_TYPE, filled: true });
        down();
        up();
        expect(toggles()).toHaveLength(1);
    });

    it('stops following the page and removes its listeners when disposed', () => {
        button.dispose();
        sendState(window.parent, { type: STATE_TYPE, filled: true });
        expect(view.attributes['aria-label']).toBe('Enter fullscreen');
    });
});
