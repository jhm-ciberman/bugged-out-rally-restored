import { bitmapButton, guiPx, SAFARI_MEDIUM_TEXT } from '../GuiControls';
import { guiScale } from '../GuiLayout';

/**
 * Shows the game's message box (`PromptOK` in PromptBoxOkDlg.gui): a green window with a title,
 * a centered message and an OK button that also answers to Enter. Resolves when it closes.
 */
export function promptOk(parent: HTMLElement, title: string, message: string): Promise<void> {
    return new Promise((resolve) => {
        // A transparent full-screen blocker, like the modal dialog control.
        const blocker = document.createElement('div');
        Object.assign(blocker.style, { position: 'absolute', inset: '0', pointerEvents: 'auto', zIndex: '100' });

        const frame = document.createElement('div');
        Object.assign(frame.style, {
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: guiPx(300),
            minHeight: guiPx(129),
            boxSizing: 'border-box',
            background: 'rgb(117, 185, 100)',
            border: '2px solid rgb(255, 215, 0)',
            padding: guiPx(6),
        });
        const titleBar = document.createElement('div');
        titleBar.textContent = title;
        Object.assign(titleBar.style, { ...SAFARI_MEDIUM_TEXT, marginBottom: guiPx(8) });
        const body = document.createElement('div');
        body.textContent = message;
        Object.assign(body.style, {
            ...SAFARI_MEDIUM_TEXT,
            textAlign: 'center',
            padding: `0 ${guiPx(20)} ${guiPx(12)}`,
        });
        // The box grows with the menu behind it, but stays readable on a screen smaller than the original.
        const scaleToScreen = () => {
            const scale = Math.max(1, guiScale(window.innerWidth, window.innerHeight));
            blocker.style.setProperty('--gui-scale', String(scale));
        };
        scaleToScreen();
        window.addEventListener('resize', scaleToScreen);
        const close = () => {
            window.removeEventListener('resize', scaleToScreen);
            window.removeEventListener('keydown', onKey, true);
            blocker.remove();
            resolve();
        };
        const ok = bitmapButton('buttons/ok', close);
        Object.assign(ok.style, { display: 'block', width: guiPx(96), height: guiPx(32), margin: '0 auto' });
        const onKey = (e: KeyboardEvent) => {
            if (e.code === 'Enter' || e.code === 'NumpadEnter') {
                e.preventDefault();
                e.stopPropagation();
                close();
            }
        };
        window.addEventListener('keydown', onKey, true);
        frame.append(titleBar, body, ok);
        blocker.append(frame);
        parent.append(blocker);
    });
}
