import { MenuScreen, rel } from './MenuScreen';

/** The publisher's site. The original linked a games page there that no longer exists. */
const MORE_GAMES_URL = 'https://www.winterwolves.com/';

/**
 * The page shown when leaving from the main menu (`advpagePromo`): the publisher's other
 * games, a button to their site and Quit.
 */
export class QuitPage extends MenuScreen {
    constructor(onQuit: () => void) {
        super('advpage.jpg');
        this.button('quit', rel(40, 528, 95, 30), onQuit);
        this.button('getmoregame', rel(258, 512, 280, 61), () => {
            window.open(MORE_GAMES_URL, '_blank', 'noopener');
        });
    }
}
