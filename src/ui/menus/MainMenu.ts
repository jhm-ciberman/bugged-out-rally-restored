import { MenuScreen, rel } from './MenuScreen';

/**
 * What the main menu asks for.
 */
export interface MainMenuActions {
    start(): void;
    about(): void;
    options(): void;
    quit(): void;
}

/**
 * The main menu (`startMenuGui.gui`): Start, About, Options and Quit on the bottom bar.
 * The "Get more games" button of the original is left out.
 */
export class MainMenu extends MenuScreen {
    constructor(actions: MainMenuActions) {
        super('mainmenu.jpg');
        this.button('start', rel(45, 525, 95, 30), () => actions.start());
        this.button('quit', rel(635, 525, 95, 30), () => actions.quit());
        this.button('options', rel(295, 525, 95, 30), () => actions.options());
        this.button('about', rel(165, 525, 95, 30), () => actions.about());
    }
}
