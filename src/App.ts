import type { RaceEvent } from './ai/BotRoster';
import { assetUrl } from './assets/AssetPaths';
import type { Game, RaceResult } from './Game';
import { CARS, type CarEntry } from './game/CarCatalog';
import { firstPrize, KILL_VALUE, placePrize } from './game/Prizes';
import { loadProfiles, newProfile, type Profile, recordResult } from './game/Profiles';
import { buttonSounds } from './ui/GuiControls';
import { AboutPage } from './ui/menus/AboutPage';
import { IngameMenu } from './ui/menus/IngameMenu';
import { LoadingScreen } from './ui/menus/LoadingScreen';
import { MainMenu } from './ui/menus/MainMenu';
import type { MenuScreen } from './ui/menus/MenuScreen';
import { OptionsMenu } from './ui/menus/OptionsMenu';
import { PlayerSelection } from './ui/menus/PlayerSelection';
import { isTrackUnlocked, VenueSelection } from './ui/menus/VenueSelection';

/** Fewest racers for a first place to open the next track (`addPlayerWinnings`). */
const MIN_RACERS_FOR_UNLOCK = 4;

/**
 * A race the player set up on the menus.
 */
interface RacePlan {
    readonly profile: Profile;
    readonly car: CarEntry;
    readonly event: RaceEvent;
    readonly track: number;
}

/**
 * The game's screen flow (as in the original): splash, main menu, player selection, venue selection,
 * loading screen, race, and back to the main menu.
 */
export class App {
    /** The page on screen (menus) and a dialog over it (options, about, in-race menu). */
    private _page: MenuScreen | null = null;
    private _dialog: MenuScreen | null = null;
    private _plan: RacePlan | null = null;
    private _racing = false;

    constructor(
        private readonly _game: Game,
        private readonly _ui: HTMLElement,
    ) {
        buttonSounds.over = () => void _game.audio.play2d('AudioButtonOver');
        buttonSounds.down = () => void _game.audio.play2d('AudioButtonDown');
        window.addEventListener('keydown', this._onKey);
    }

    /**
     * Starts at the splash screen.
     */
    start(): void {
        // The splash waits for a click, which also lets the browser start the audio.
        const splash = document.createElement('div');
        Object.assign(splash.style, {
            position: 'absolute',
            inset: '0',
            background: `#000 url(${assetUrl('common/ui/splashscreen00.jpg')}) center / contain no-repeat`,
            pointerEvents: 'auto',
            cursor: 'pointer',
        });
        const go = () => {
            splash.remove();
            this.mainMenu();
        };
        splash.addEventListener('click', go, { once: true });
        this._ui.append(splash);
    }

    /**
     * Goes straight into a race, skipping the menus (for development links such as `?track=3&car=Hornet`).
     */
    quickRace(track: number, carDatablock: string, event: RaceEvent, winnings: number): void {
        const car = CARS.find((c) => c.datablock.toLowerCase() === carDatablock.toLowerCase()) ?? CARS[2];
        const profile = { ...newProfile('Player'), points: winnings, highestSingle: 7, highestCircuit: 7 };
        void this._race({ profile, car, event, track }, false);
    }

    /**
     * Shows the main menu, with the menu music.
     */
    mainMenu(): void {
        this._endRace();
        void this._game.audio.playMusic('GuiTheme');
        this._setPage(
            new MainMenu({
                start: () => this._playerSelection(),
                about: () => this._openDialog(new AboutPage(() => this._closeDialog())),
                options: () => this._options(),
                quit: () => {
                    this._setPage(null);
                    this._game.audio.stopMusic();
                    this.start();
                },
            }),
        );
    }

    private _playerSelection(): void {
        this._setPage(
            new PlayerSelection(
                this._game.models,
                this._ui,
                () => this.mainMenu(),
                ({ profile, car }) => this._venueSelection(profile, car),
            ),
        );
    }

    private _venueSelection(profile: Profile, car: CarEntry): void {
        this._setPage(
            new VenueSelection(
                profile,
                this._ui,
                () => this._playerSelection(),
                (track, event) => void this._race({ profile, car, event, track }),
            ),
        );
    }

    private _options(): void {
        this._openDialog(
            new OptionsMenu(
                () => this._closeDialog(),
                () => this._game.audio.applySettings(),
            ),
        );
    }

    private async _race(plan: RacePlan, withLoadingScreen = true): Promise<void> {
        this._closeDialog();
        this._endRace();
        this._plan = plan;
        const loading = new LoadingScreen(plan.profile.name, plan.car, plan.event, plan.track, () => this.mainMenu());
        if (withLoadingScreen) this._setPage(loading);
        else this._setPage(null);
        this._game.audio.stopMusic();
        try {
            await this._game.startRace({
                track: plan.track,
                carName: plan.car.datablock,
                event: plan.event,
                winnings: plan.profile.points,
                onProgress: (step, fraction) => loading.setProgress(step, fraction),
                onFinished: (result) => this._award(plan, result),
                onFinishChoice: (choice) => {
                    if (choice.action === 'quit') this.mainMenu();
                    else this._restart(choice.track);
                },
            });
        } catch (err) {
            console.error('Race failed to load', err);
            this.mainMenu();
            return;
        }
        // Cancelled while loading.
        if (this._plan !== plan) return;
        this._racing = true;
        this._setPage(null);
    }

    private _restart(track: number): void {
        if (!this._plan) return;
        const profile = loadProfiles().find((p) => p.name === this._plan?.profile.name) ?? this._plan.profile;
        void this._race({ ...this._plan, profile, track });
    }

    /**
     * Pays the player and opens the next track, like `addPlayerWinnings` in server/scripts/game.cs.
     */
    private _award(plan: RacePlan, result: RaceResult): void {
        if (plan.event === 'explore') return;
        const first = firstPrize(plan.event, plan.track - 1, result.racers);
        if (first === 0 || (result.place > 3 && result.kills === 0)) return;
        const winnings = placePrize(first, result.place) + result.kills * KILL_VALUE;
        const unlock =
            result.place === 1 && result.racers >= MIN_RACERS_FOR_UNLOCK
                ? { series: (plan.event === 'circuit' ? 2 : 1) as 1 | 2, trackIndex: plan.track - 1 }
                : null;
        recordResult(plan.profile.name, winnings, unlock);
    }

    private _endRace(): void {
        this._racing = false;
        this._plan = null;
        this._game.endRace();
    }

    private _setPage(page: MenuScreen | null): void {
        this._closeDialog();
        this._page?.dispose();
        this._page = page;
        page?.show(this._ui);
    }

    private _openDialog(dialog: MenuScreen): void {
        this._closeDialog();
        this._dialog = dialog;
        dialog.show(this._ui);
    }

    private _closeDialog(): void {
        this._dialog?.dispose();
        this._dialog = null;
    }

    private _ingameMenu(): void {
        const plan = this._plan;
        if (!plan) return;
        document.exitPointerLock();
        this._openDialog(
            new IngameMenu(plan.track, {
                cancel: () => this._closeDialog(),
                launch: (track) => this._restart(track),
                options: () => this._options(),
                quit: () => this.mainMenu(),
                canRace: (track) => isTrackUnlocked(plan.profile, plan.event, track - 1),
            }),
        );
    }

    // Escape opens the in-race menu, unless the race is over (`escapeFromGame`).
    private readonly _onKey = (e: KeyboardEvent): void => {
        if (e.code !== 'Escape' || !this._racing || this._dialog) return;
        if (this._game.session?.playerRacer.finishTime !== null) return;
        this._ingameMenu();
    };
}
