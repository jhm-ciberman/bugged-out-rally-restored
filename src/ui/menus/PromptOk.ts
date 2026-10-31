import { bitmapButton, SAFARI_MEDIUM_TEXT } from '../GuiControls';

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
            width: '300px',
            minHeight: '129px',
            boxSizing: 'border-box',
            background: 'rgb(117, 185, 100)',
            border: '2px solid rgb(255, 215, 0)',
            padding: '6px',
        });
        const titleBar = document.createElement('div');
        titleBar.textContent = title;
        Object.assign(titleBar.style, { ...SAFARI_MEDIUM_TEXT, marginBottom: '8px' });
        const body = document.createElement('div');
        body.textContent = message;
        Object.assign(body.style, { ...SAFARI_MEDIUM_TEXT, textAlign: 'center', padding: '0 20px 12px' });
        const close = () => {
            window.removeEventListener('keydown', onKey, true);
            blocker.remove();
            resolve();
        };
        const ok = bitmapButton('buttons/ok', close);
        Object.assign(ok.style, { display: 'block', width: '96px', height: '32px', margin: '0 auto' });
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
