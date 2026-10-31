import { TRACK_NAMES } from '../../game/Tracks';
import { MEDIUM_TEXT, setButtonEnabled } from '../GuiControls';
import { MenuScreen, rel } from './MenuScreen';

/**
 * What the in-race menu asks for.
 */
export interface IngameActions {
    /** Close the menu and keep racing. */
    cancel(): void;
    /** Restart on `track` (1 to 8). */
    launch(track: number): void;
    options(): void;
    /** Leave the race for the main menu. */
    quit(): void;
    /** Whether the player may race `track` in the current event. */
    canRace(track: number): boolean;
}

/**
 * The in-race menu opened with Escape (`IngameGui.gui`): a strip at the bottom with Cancel, Launch (restart
 * or another track), Options and Quit. The race keeps running behind it, as in the original.
 */
export class IngameMenu extends MenuScreen {
    private _track: number;
    private readonly _launch: HTMLButtonElement;
    private readonly _venue: HTMLElement;

    constructor(
        track: number,
        private readonly _actions: IngameActions,
    ) {
        super(null);
        this._track = track - 1;
        this.image('ingamegui_n.png', rel(0, 475, 800, 125));
        this.button('options', rel(440, 516, 95, 34), () => _actions.options());
        this.button('quit', rel(630, 516, 95, 34), () => _actions.quit());
        this.button('cancel', rel(30, 516, 95, 34), () => _actions.cancel());
        this._launch = this.button('launch', rel(241, 502, 96, 33), () => _actions.launch(this._track + 1));
        this.button('buttons/right', rel(384, 540, 33, 30), () => this._cycle(1), true);
        this.button('buttons/left', rel(170, 540, 34, 30), () => this._cycle(-1), true);
        this._venue = this.text('', MEDIUM_TEXT, rel(195, 543, 198, 24), { textAlign: 'center' });
        this._cycle(0);
        window.addEventListener('keydown', this._onKey);
    }

    override dispose(): void {
        window.removeEventListener('keydown', this._onKey);
        super.dispose();
    }

    private _cycle(step: number): void {
        this._track = (this._track + step + TRACK_NAMES.length) % TRACK_NAMES.length;
        this._venue.textContent = TRACK_NAMES[this._track];
        setButtonEnabled(this._launch, this._actions.canRace(this._track + 1), 'launch');
    }

    // Escape is the Cancel button's accelerator.
    private readonly _onKey = (e: KeyboardEvent): void => {
        if (e.code === 'Escape') this._actions.cancel();
    };
}
