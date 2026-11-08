const TOGGLE_MESSAGE = { type: 'bugged-out-rally:toggle-fullscreen' };
const REQUEST_STATE_MESSAGE = { type: 'bugged-out-rally:request-fullscreen-state' };
const STATE_MESSAGE_TYPE = 'bugged-out-rally:fullscreen-state';

/**
 * Returns whether the game runs inside another page's iframe.
 */
export function isFramed(): boolean {
    return window.parent !== window;
}

/**
 * Asks the page around the game to enter or leave its full-page mode.
 */
export function togglePageFullscreen(): void {
    window.parent.postMessage(TOGGLE_MESSAGE, '*');
}

/**
 * Asks the page around the game for its full-page state and calls `listener` with it, now and on every change.
 * Only the parent page is believed. Returns a function that stops listening.
 */
export function watchPageFullscreen(listener: (filled: boolean) => void): () => void {
    const onMessage = (e: MessageEvent): void => {
        if (e.source !== window.parent || e.data?.type !== STATE_MESSAGE_TYPE) return;
        if (typeof e.data.filled === 'boolean') listener(e.data.filled);
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage(REQUEST_STATE_MESSAGE, '*');
    return () => window.removeEventListener('message', onMessage);
}

/**
 * Makes `box` show and control the real fullscreen state: the page's when the game is framed, since an iframe
 * can't see it, and the browser's otherwise. `repaint` redraws the box after its state is set. Returns a function
 * that disconnects it.
 */
export function bindFullscreenCheckbox(box: HTMLInputElement, repaint: () => void): () => void {
    const show = (on: boolean): void => {
        box.checked = on;
        repaint();
    };
    if (isFramed()) {
        const stopWatching = watchPageFullscreen(show);
        box.addEventListener('change', togglePageFullscreen);
        return () => {
            stopWatching();
            box.removeEventListener('change', togglePageFullscreen);
        };
    }
    const showBrowserState = (): void => show(document.fullscreenElement !== null);
    const onChange = (): void => {
        if (box.checked) {
            void (document.documentElement.requestFullscreen?.() ?? Promise.reject()).catch(showBrowserState);
        } else if (document.fullscreenElement) {
            void document.exitFullscreen();
        }
    };
    showBrowserState();
    box.addEventListener('change', onChange);
    document.addEventListener('fullscreenchange', showBrowserState);
    return () => {
        box.removeEventListener('change', onChange);
        document.removeEventListener('fullscreenchange', showBrowserState);
    };
}
