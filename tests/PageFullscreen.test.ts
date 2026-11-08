import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindFullscreenCheckbox, isFramed, togglePageFullscreen, watchPageFullscreen } from '../src/ui/PageFullscreen';

const TOGGLE = { type: 'bugged-out-rally:toggle-fullscreen' };
const REQUEST = { type: 'bugged-out-rally:request-fullscreen-state' };
const STATE_TYPE = 'bugged-out-rally:fullscreen-state';

function fakeBox(): EventTarget & { checked: boolean } {
    return Object.assign(new EventTarget(), { checked: false });
}

const sendState = (source: unknown, data: unknown) =>
    window.dispatchEvent(Object.assign(new Event('message'), { source, data }));

describe('PageFullscreen', () => {
    let postToParent: ReturnType<typeof vi.fn>;
    let repaint: ReturnType<typeof vi.fn<() => void>>;
    let box: ReturnType<typeof fakeBox>;
    let requestFullscreen: ReturnType<typeof vi.fn> | undefined;
    let exitFullscreen: ReturnType<typeof vi.fn>;
    const bind = () => bindFullscreenCheckbox(box as unknown as HTMLInputElement, repaint);
    const fullscreenElement = (value: unknown) => Object.assign(document, { fullscreenElement: value });

    function stubPage(framed: boolean): void {
        const page = Object.assign(new EventTarget(), {});
        Object.assign(page, { parent: framed ? { postMessage: postToParent } : page });
        vi.stubGlobal('window', page);
        vi.stubGlobal(
            'document',
            Object.assign(new EventTarget(), {
                fullscreenElement: null,
                exitFullscreen,
                documentElement: { requestFullscreen },
            }),
        );
    }

    beforeEach(() => {
        postToParent = vi.fn();
        repaint = vi.fn<() => void>();
        box = fakeBox();
        requestFullscreen = vi.fn(() => Promise.resolve());
        exitFullscreen = vi.fn(() => Promise.resolve());
    });
    afterEach(() => vi.unstubAllGlobals());

    describe('framed', () => {
        beforeEach(() => stubPage(true));

        it('knows it is framed', () => {
            expect(isFramed()).toBe(true);
        });

        it('posts the toggle to the parent', () => {
            togglePageFullscreen();
            expect(postToParent.mock.calls).toEqual([[TOGGLE, '*']]);
        });

        it('asks for the state and reports it', () => {
            const listener = vi.fn();
            watchPageFullscreen(listener);
            expect(postToParent.mock.calls).toEqual([[REQUEST, '*']]);
            sendState(window.parent, { type: STATE_TYPE, filled: true });
            expect(listener).toHaveBeenCalledExactlyOnceWith(true);
        });

        it('only believes the parent', () => {
            const listener = vi.fn();
            watchPageFullscreen(listener);
            sendState({}, { type: STATE_TYPE, filled: true });
            expect(listener).not.toHaveBeenCalled();
        });

        it('ignores other messages and a malformed state', () => {
            const listener = vi.fn();
            watchPageFullscreen(listener);
            sendState(window.parent, { type: 'other', filled: true });
            sendState(window.parent, { type: STATE_TYPE, filled: 'yes' });
            sendState(window.parent, null);
            expect(listener).not.toHaveBeenCalled();
        });

        it('stops when asked', () => {
            const listener = vi.fn();
            watchPageFullscreen(listener)();
            sendState(window.parent, { type: STATE_TYPE, filled: true });
            expect(listener).not.toHaveBeenCalled();
        });

        it('makes the checkbox follow the page and repaints it', () => {
            bind();
            expect(postToParent.mock.calls).toEqual([[REQUEST, '*']]);
            sendState(window.parent, { type: STATE_TYPE, filled: true });
            expect(box.checked).toBe(true);
            expect(repaint).toHaveBeenCalledOnce();
            sendState(window.parent, { type: STATE_TYPE, filled: false });
            expect(box.checked).toBe(false);
        });

        it('posts the toggle when the checkbox changes, and leaves the browser alone', () => {
            bind();
            box.checked = true;
            box.dispatchEvent(new Event('change'));
            expect(postToParent).toHaveBeenLastCalledWith(TOGGLE, '*');
            expect(requestFullscreen).not.toHaveBeenCalled();
        });

        it('ignores the browser fullscreen event', () => {
            bind();
            fullscreenElement({});
            document.dispatchEvent(new Event('fullscreenchange'));
            expect(box.checked).toBe(false);
        });

        it('stops following the page once unbound', () => {
            const unbind = bind();
            unbind();
            postToParent.mockClear();
            sendState(window.parent, { type: STATE_TYPE, filled: true });
            box.dispatchEvent(new Event('change'));
            expect(box.checked).toBe(false);
            expect(postToParent).not.toHaveBeenCalled();
        });
    });

    describe('not framed', () => {
        beforeEach(() => stubPage(false));

        it('knows it is not framed', () => {
            expect(isFramed()).toBe(false);
        });

        it('shows the browser state when bound', () => {
            fullscreenElement({});
            bind();
            expect(box.checked).toBe(true);
            expect(repaint).toHaveBeenCalled();
        });

        it('follows the browser while bound', () => {
            bind();
            fullscreenElement({});
            document.dispatchEvent(new Event('fullscreenchange'));
            expect(box.checked).toBe(true);
            fullscreenElement(null);
            document.dispatchEvent(new Event('fullscreenchange'));
            expect(box.checked).toBe(false);
        });

        it('stops following the browser once unbound', () => {
            bind()();
            fullscreenElement({});
            document.dispatchEvent(new Event('fullscreenchange'));
            expect(box.checked).toBe(false);
        });

        it('asks the browser for fullscreen when checked', () => {
            bind();
            box.checked = true;
            box.dispatchEvent(new Event('change'));
            expect(requestFullscreen).toHaveBeenCalledOnce();
        });

        it('leaves fullscreen when unchecked', () => {
            fullscreenElement({});
            bind();
            box.checked = false;
            box.dispatchEvent(new Event('change'));
            expect(exitFullscreen).toHaveBeenCalledOnce();
        });

        it('unchecks itself when the browser refuses', async () => {
            requestFullscreen = vi.fn(() => Promise.reject(new Error('refused')));
            stubPage(false);
            bind();
            box.checked = true;
            box.dispatchEvent(new Event('change'));
            await new Promise((resolve) => setTimeout(resolve));
            expect(box.checked).toBe(false);
        });

        it('unchecks itself when the browser has no fullscreen', async () => {
            requestFullscreen = undefined;
            stubPage(false);
            bind();
            box.checked = true;
            box.dispatchEvent(new Event('change'));
            await new Promise((resolve) => setTimeout(resolve));
            expect(box.checked).toBe(false);
        });

        it('never talks to a parent page', () => {
            bind();
            box.checked = true;
            box.dispatchEvent(new Event('change'));
            expect(postToParent).not.toHaveBeenCalled();
        });
    });
});
