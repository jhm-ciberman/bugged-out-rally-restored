import type { RaceEvent } from '../../ai/BotRoster';
import { firstPrize } from '../../game/Prizes';
import type { Profile } from '../../game/Profiles';
import { getSettings } from '../../game/Settings';
import { TRACK_NAMES } from '../../game/Tracks';
import { ABOUT_TEXT, MEDIUM_RED_TEXT, MEDIUM_TEXT, setButtonEnabled } from '../GuiControls';
import { MenuScreen, rel640 } from './MenuScreen';
import { promptOk } from './PromptOk';

/** The events in menu order, with their picture, name and hint (`ShowCurEvent`). */
const EVENTS: readonly { id: RaceEvent; name: string; picture: string; hint: string }[] = [
    {
        id: 'explore',
        name: 'Explore',
        picture: 'event_freerun.jpg',
        hint: 'There are no Bots in this event, leaving it open for you to roam freely.',
    },
    {
        id: 'single',
        name: 'Single Event',
        picture: 'event_single.jpg',
        hint: 'There are 3 Bots in the event.\nStart with this challenge to gain experience and earn some money.',
    },
    {
        id: 'circuit',
        name: 'Race Circuit',
        picture: 'event_world.jpg',
        hint: 'There are 5 Bots in the event.\nThis is a major event and should only be entered after you have gained more advanced bugs.',
    },
];

/** The purse on the menu is the first prize times this; the prize paid is not multiplied (`venueCalcPurse`). */
const PURSE_DISPLAY_FACTOR = 1.75;

/**
 * Returns whether track `index` (0 to 7) is open for `profile` in `event`'s series:
 * Explore and Single share one series, Circuit has its own.
 */
export function isTrackUnlocked(profile: Profile, event: RaceEvent, index: number): boolean {
    if (getSettings().unlockAll) return true;
    const highest = event === 'circuit' ? profile.highestCircuit : profile.highestSingle;
    return highest >= index;
}

/**
 * The venue selection menu (`venueSelectionMenu.gui`): pick the event and the track, then start.
 */
export class VenueSelection extends MenuScreen {
    private _event = 0;
    private _track = 0;
    private readonly _eventPictures: HTMLImageElement[] = [];
    private readonly _eventName: HTMLElement;
    private readonly _eventHint: HTMLElement;
    private readonly _trackPic: HTMLImageElement;
    private readonly _levelLocked: HTMLImageElement;
    private readonly _price: HTMLElement;
    private readonly _venueName: HTMLElement;

    constructor(
        private readonly _profile: Profile,
        private readonly _parent: HTMLElement,
        private readonly _onBack: () => void,
        private readonly _onStart: (track: number, event: RaceEvent) => void,
    ) {
        super('venueselection.jpg');
        this.button('back', rel640(480, 420, 76, 24), () => this._onBack());
        this.button('singleplayer', rel640(48, 420, 128, 24), () => void this._start());
        // The original also races over the network (`StartOnline`); this port has no network play.
        const online = this.button('online', rel640(282, 420, 76, 24), () => undefined);
        setButtonEnabled(online, false, 'online');
        online.title = 'Online play is not available in this version.';
        this.button('buttons/left', rel640(357, 241, 24, 24), () => this._setTrack(this._track - 1));
        this.button('buttons/right', rel640(552, 241, 24, 24), () => this._setTrack(this._track + 1));
        this._trackPic = this.image('track1.jpg', rel640(369, 63, 195, 163));
        this._levelLocked = this.image('ridelocked.png', rel640(369, 63, 195, 163));
        this._price = this.text('', MEDIUM_RED_TEXT, rel640(372, 61, 192, 36));
        this._venueName = this.text('', MEDIUM_TEXT, rel640(376, 244, 179, 24), { textAlign: 'center' });
        this.button('buttons/right', rel640(241, 241, 24, 24), () => this._setEvent(this._event + 1));
        this.button('buttons/left', rel640(45, 241, 24, 24), () => this._setEvent(this._event - 1));
        this._eventName = this.text('', MEDIUM_TEXT, rel640(71, 244, 170, 24), { textAlign: 'center' });
        for (const e of EVENTS) this._eventPictures.push(this.image(e.picture, rel640(74, 64, 160, 160)));
        this.image('noteblock.png', rel640(36, 265, 248, 104));
        this.image('noteblock.png', rel640(350, 265, 247, 104));
        this._eventHint = this.marginText('', ABOUT_TEXT, rel640(47, 275, 214, 48));
        this.marginText(
            'Select different tracks by pressing the left or right arrows.\nTracks will be locked until you win the previous track and event.',
            ABOUT_TEXT,
            rel640(362, 277, 214, 80),
        );
        this._setTrack(0);
        this._setEvent(0);
    }

    private _setEvent(index: number): void {
        this._event = (index + EVENTS.length) % EVENTS.length;
        const e = EVENTS[this._event];
        this._eventPictures.forEach((img, i) => {
            img.style.display = i === this._event ? '' : 'none';
        });
        this._eventName.textContent = e.name;
        this._eventHint.textContent = e.hint;
        this._showLock();
    }

    private _setTrack(index: number): void {
        this._track = (index + TRACK_NAMES.length) % TRACK_NAMES.length;
        this._venueName.textContent = TRACK_NAMES[this._track];
        this._trackPic.src = this._trackPic.src.replace(/track\d\.jpg$/, `track${this._track + 1}.jpg`);
        this._showLock();
    }

    private _showLock(): void {
        const event = EVENTS[this._event].id;
        this._levelLocked.style.display = isTrackUnlocked(this._profile, event, this._track) ? 'none' : '';
        // The purse ignores the racer count: it is shown before the race has any.
        const purse = firstPrize(event, this._track, Number.POSITIVE_INFINITY) * PURSE_DISPLAY_FACTOR;
        this._price.textContent = `$${purse} Purse`;
    }

    private async _start(): Promise<void> {
        const event = EVENTS[this._event].id;
        if (!isTrackUnlocked(this._profile, event, this._track)) {
            await promptOk(this._parent, 'Level is locked!', 'Please select one of the unlocked levels.');
            return;
        }
        this._onStart(this._track + 1, event);
    }
}
