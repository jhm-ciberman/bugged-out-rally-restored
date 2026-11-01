import { ACTIONS, type Action, bind, bindingOf, inputName } from '../../input/KeyBindings';
import { ABOUT_TEXT, arialFont, MEDIUM_TEXT } from '../GuiControls';
import { MenuScreen, rel, rel640 } from './MenuScreen';

/** `GuiTextListProfile`: Arial 14, black. */
const LIST_TEXT = { font: arialFont(14), color: '#000' };
/** Left edge of the binding column, in pixels (`columns = "0 240"`). */
const BINDING_COLUMN = 240;

/**
 * The controls menu (`controlMenu.gui`): every action with its key. Double clicking a row asks for a new
 * key or mouse button (`RemapDlg`).
 */
export class ControlMenu extends MenuScreen {
    private readonly _rows = new Map<Action, HTMLElement>();
    private _prompt: HTMLElement | null = null;

    constructor(onBack: () => void) {
        super('controlview.jpg');
        this.text('Control Name', MEDIUM_TEXT, rel(66, 50, 161, 35));
        this.text('Control Binding', MEDIUM_TEXT, rel(286, 50, 185, 35));

        // `GuiScrollProfile`: orange fill with a black border.
        const scroll = this.add(document.createElement('div'), rel(50, 80, 405, 365));
        Object.assign(scroll.style, {
            background: 'rgb(255, 192, 55)',
            border: '2px solid #000',
            boxSizing: 'border-box',
            overflowY: 'auto',
            padding: '2px',
        });
        for (const { action, name } of ACTIONS) {
            const row = document.createElement('div');
            Object.assign(row.style, { ...LIST_TEXT, display: 'flex', lineHeight: '18px', cursor: 'default' });
            const label = document.createElement('span');
            label.textContent = name;
            label.style.flex = `0 0 ${BINDING_COLUMN}px`;
            row.append(label, document.createElement('span'));
            row.addEventListener('mousedown', () => this._select(action));
            row.addEventListener('dblclick', () => this._remap(action, name));
            scroll.append(row);
            this._rows.set(action, row);
        }
        this._refresh();

        this.marginText(
            'Double click on the line to edit the keys.  Assign new keys when a REMAP dialog appears.',
            ABOUT_TEXT,
            rel(473, 216, 265, 32),
        );
        // The original points at `buttons/back`, which never shipped; `back` is the art it meant.
        this.button('back', rel(71, 525, 95, 30), onBack);
    }

    override dispose(): void {
        this._closePrompt();
        super.dispose();
    }

    private _select(action: Action): void {
        for (const [a, row] of this._rows) row.style.background = a === action ? 'rgb(220, 220, 220)' : '';
    }

    private _refresh(): void {
        for (const [action, row] of this._rows) {
            (row.lastElementChild as HTMLElement).textContent = inputName(bindingOf(action));
        }
    }

    /**
     * Shows the remap window and binds the next key or mouse button pressed. Escape cancels.
     */
    private _remap(action: Action, name: string): void {
        this._closePrompt();
        // `GuiWindowProfile`: an orange window with white, centered text.
        const prompt = this.add(document.createElement('div'), rel640(213, 213, 243, 64));
        Object.assign(prompt.style, {
            background: 'rgb(255, 192, 55)',
            border: '2px solid #000',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            font: arialFont(16, true),
            color: '#fff',
            textShadow: '1px 1px 0 #000',
        });
        prompt.textContent = `REMAP "${name}"`;
        this.layout();
        this._prompt = prompt;
        const finish = (input: string | null) => {
            this._closePrompt();
            if (input) bind(action, input);
            this._refresh();
            this._select(action);
        };
        const onKey = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            finish(e.code === 'Escape' ? null : e.code);
        };
        const onMouse = (e: MouseEvent) => {
            const input = ['Mouse0', 'Mouse2', 'Mouse1'][e.button];
            if (!input) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            finish(input);
        };
        // A mouse button press right after the double click would end it at once, so wait for the next one.
        setTimeout(() => {
            if (this._prompt !== prompt) return;
            window.addEventListener('mousedown', onMouse, true);
        }, 0);
        window.addEventListener('keydown', onKey, true);
        this._closePrompt = () => {
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('mousedown', onMouse, true);
            prompt.remove();
            this._prompt = null;
            this._closePrompt = () => undefined;
        };
    }

    private _closePrompt: () => void = () => undefined;
}
