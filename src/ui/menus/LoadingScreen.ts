import type { RaceEvent } from '../../ai/BotRoster';
import type { CarEntry } from '../../game/CarCatalog';
import { TRACK_NAMES } from '../../game/Tracks';
import { MEDIUM_RED_TEXT, SHADOW } from '../GuiControls';
import { MenuScreen, rel } from './MenuScreen';

const EVENT_LOOK: Record<RaceEvent, { picture: string; name: string }> = {
    explore: { picture: 'event_freerun.jpg', name: 'Explore' },
    single: { picture: 'event_single.jpg', name: 'Single Event' },
    circuit: { picture: 'event_world.jpg', name: 'Race Circuit' },
};

/**
 * The loading screen (`loadingGui.gui`): the player, the bug, the event and the track, with a progress bar.
 */
export class LoadingScreen extends MenuScreen {
    private readonly _bar: HTMLDivElement;
    private readonly _barText: HTMLDivElement;

    constructor(playerName: string, car: CarEntry, event: RaceEvent, track: number, onCancel: () => void) {
        super('loadselection.jpg');
        this.text(TRACK_NAMES[track - 1], MEDIUM_RED_TEXT, rel(560, 51, 160, 24), { textShadow: SHADOW });
        const progress = this.add(document.createElement('div'), rel(255, 377, 295, 36));
        Object.assign(progress.style, { border: '1px solid rgb(255, 215, 0)', boxSizing: 'border-box' });
        this._bar = document.createElement('div');
        Object.assign(this._bar.style, { height: '100%', width: '0%', background: 'rgba(44, 152, 162, 0.39)' });
        this._barText = document.createElement('div');
        Object.assign(this._barText.style, {
            position: 'absolute',
            inset: '0',
            color: '#fff',
            font: '14px Arial, sans-serif',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        });
        progress.style.position = 'absolute';
        progress.append(this._bar, this._barText);
        this.image(car.loadingPicture, rel(52, 96, 185, 179));
        this.text(playerName, MEDIUM_RED_TEXT, rel(52, 51, 160, 24), { textShadow: SHADOW });
        this.image(EVENT_LOOK[event].picture, rel(310, 95, 185, 180));
        this.text(EVENT_LOOK[event].name, MEDIUM_RED_TEXT, rel(310, 51, 160, 24), { textShadow: SHADOW });
        this.image(`track${track}.jpg`, rel(560, 95, 190, 180));
        this.button('cancel', rel(348, 432, 96, 32), onCancel);
        this.setProgress('LOADING MISSION', 0);
    }

    /**
     * Shows a loading step and how far along it is (0 to 1).
     */
    setProgress(text: string, fraction: number): void {
        this._barText.textContent = text;
        this._bar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    }
}
