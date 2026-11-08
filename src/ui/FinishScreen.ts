import type { RaceEvent } from '../ai/BotRoster';
import { assetUrl } from '../assets/AssetPaths';
import { firstPrize, KILL_VALUE, placePrize } from '../game/Prizes';
import type { Racer } from '../game/Race';
import type { RaceSession } from '../game/RaceSession';
import { TRACK_NAMES } from '../game/Tracks';
import { bitmapButton, guiPx, MEDIUM_TEXT, SAFARI_MEDIUM_TEXT, setButtonEnabled } from './GuiControls';
import { fitStage, type GuiRect, placeControl } from './GuiLayout';
import { formatRaceTime } from './Hud';

const rel = (x: number, y: number, w: number, h: number): GuiRect => ({
    x,
    y,
    w,
    h,
    horiz: 'relative',
    vert: 'relative',
});

/** Row positions of the scoreboard (`finishGameGui.gui`; the uneven spacing is in the original). */
const NAME_ROWS = [82, 112, 142, 175, 202, 232, 262, 292];
const SCORE_ROWS = [82, 112, 142, 175, 202, 232, 275, 302];
/** The scoreboard panel's corner; the rows are placed inside it. */
const PANEL = { x: 38, y: 1 };
/** The button bar's corner. */
const BAR = { x: 0, y: 475 };

/**
 * What the player picked on the finish screen.
 */
export type FinishChoice = { action: 'replay'; track: number } | { action: 'options' } | { action: 'quit' };

/**
 * What the finish screen reports to, and asks of, the game.
 */
export interface FinishActions {
    /** Called with each choice the player makes. */
    onChoice(choice: FinishChoice): void;
    /** Whether the player may race `track` (1 to 8) next. */
    canRace(track: number): boolean;
}

/**
 * The end-of-race scoreboard with its button bar (`finishGameGui.gui`): lap times, prize and kills per racer,
 * a track picker, Replay and Quit.
 */
export class FinishScreen {
    readonly element = document.createElement('div');
    private readonly _names: HTMLElement[] = [];
    private readonly _scores: HTMLElement[] = [];
    private readonly _venue = document.createElement('div');
    private readonly _launch: HTMLButtonElement;
    private readonly _layout: { el: HTMLElement; rect: GuiRect }[] = [];
    /** The 4:3 area holding the scoreboard; the dimmed race shows around it on wide screens. */
    private readonly _stage = document.createElement('div');
    /** Track picked for the next race with the arrows. */
    private _track: number;
    /** Track of the race that just ended (index 0 to 7), which sets the prize. */
    private readonly _raceTrack: number;

    constructor(
        parent: HTMLElement,
        private readonly _session: RaceSession,
        private readonly _event: RaceEvent,
        trackNumber: number,
        private readonly _actions: FinishActions,
    ) {
        this._track = trackNumber - 1;
        this._raceTrack = trackNumber - 1;
        const e = this.element;
        e.append(this._stage);
        Object.assign(e.style, {
            position: 'absolute',
            inset: '0',
            background: `url(${assetUrl('client/ui/hudfill.png')}) center / 100% 100%`,
            pointerEvents: 'auto',
            overflow: 'hidden',
        });

        this._add(this._image('scoreboard_n.png'), rel(PANEL.x, PANEL.y, 725, 425));
        this._add(this._text('Game Over - Final Scores:', MEDIUM_TEXT), rel(PANEL.x + 237, PANEL.y + 12, 250, 30));
        this._add(
            this._text('Lap1   \tLap2    \tLap3    \tFinal   \tPrize   \tKills', SAFARI_MEDIUM_TEXT),
            rel(PANEL.x + 242, PANEL.y + 50, 344, 22),
        );
        for (let i = 0; i < 8; i++) {
            const name = this._text('', SAFARI_MEDIUM_TEXT);
            const score = this._text('', SAFARI_MEDIUM_TEXT);
            this._names.push(name);
            this._scores.push(score);
            this._add(name, rel(PANEL.x + 45, PANEL.y + NAME_ROWS[i], 180, 22));
            this._add(score, rel(PANEL.x + 242, PANEL.y + SCORE_ROWS[i], 340, 22));
        }

        this._add(this._image('ingamegui_n.png'), rel(BAR.x, BAR.y, 800, 125));
        this._add(
            bitmapButton('quit', () => this._actions.onChoice({ action: 'quit' })),
            rel(BAR.x + 650, BAR.y + 50, 95, 31),
        );
        this._add(
            bitmapButton('options', () => this._actions.onChoice({ action: 'options' })),
            rel(BAR.x + 385, BAR.y + 50, 95, 31),
        );
        this._launch = bitmapButton('launch', () =>
            this._actions.onChoice({ action: 'replay', track: this._track + 1 }),
        );
        this._add(this._launch, rel(BAR.x + 114, BAR.y + 29, 95, 33));
        // The arrows use `GuiDefaultProfile`, which has no button sounds.
        this._add(
            bitmapButton('buttons/left', () => this._cycle(-1), { silent: true }),
            rel(BAR.x + 37, BAR.y + 71, 25, 27),
        );
        this._add(
            bitmapButton('buttons/right', () => this._cycle(1), { silent: true }),
            rel(BAR.x + 262, BAR.y + 71, 25, 27),
        );
        Object.assign(this._venue.style, { ...MEDIUM_TEXT, textAlign: 'center', whiteSpace: 'nowrap' });
        this._add(this._venue, rel(BAR.x + 62, BAR.y + 71, 202, 24));
        this._cycle(0);

        parent.append(e);
        this.resize(window.innerWidth, window.innerHeight);
        this.refresh();
        window.addEventListener('keydown', this._onKey);
    }

    /**
     * Rewrites the rows from the current standings. Racers still on the track show as running until they finish.
     */
    refresh(): void {
        const race = this._session.race;
        const standings = race.standings();
        const first = firstPrize(this._event, this._raceTrack, race.racers.length);
        standings.forEach((racer, i) => {
            if (i >= 8) return;
            const car = this._session.cars.find((c) => c.vehicle === racer.vehicle);
            const tag = racer === this._session.playerRacer ? PLAYER_TAG : BOT_TAG;
            setTorqueText(this._names[i], `${i + 1}. ${racer.name.padEnd(NAME_WIDTH)}${tag}`);
            setTorqueText(this._scores[i], scoreLine(racer, i, first, car?.score ?? 0));
        });
        for (let i = standings.length; i < 8; i++) {
            setTorqueText(this._names[i], '');
            setTorqueText(this._scores[i], '');
        }
    }

    resize(width: number, height: number): void {
        const { w, h } = fitStage(this._stage, width, height);
        for (const { el, rect } of this._layout) placeControl(el, rect, w, h);
    }

    dispose(): void {
        window.removeEventListener('keydown', this._onKey);
        this.element.remove();
    }

    private _cycle(step: number): void {
        this._track = (this._track + step + TRACK_NAMES.length) % TRACK_NAMES.length;
        this._venue.textContent = TRACK_NAMES[this._track];
        // Launch is greyed out on a locked track (`SetVenueText` with `isSelectedTrackValid`).
        setButtonEnabled(this._launch, this._actions.canRace(this._track + 1), 'launch');
    }

    private _add(el: HTMLElement, rect: GuiRect): void {
        this._layout.push({ el, rect });
        this._stage.append(el);
    }

    private _image(file: string): HTMLImageElement {
        const img = document.createElement('img');
        img.src = assetUrl(`client/ui/${file}`);
        return img;
    }

    private _text(text: string, profile: { font: string; color: string }): HTMLElement {
        const t = document.createElement('div');
        Object.assign(t.style, { ...profile, whiteSpace: 'pre', lineHeight: guiPx(22) });
        setTorqueText(t, text);
        return t;
    }

    // Escape is the Quit button's accelerator.
    private readonly _onKey = (e: KeyboardEvent): void => {
        if (e.code === 'Escape') this._actions.onChoice({ action: 'quit' });
    };
}

/** Characters the scoreboard pads a racer's name to, before the tag. */
const NAME_WIDTH = 12;
/** Tags after the names: the player hosts the game, so it shows as an admin. */
const PLAYER_TAG = '*';
const BOT_TAG = '[Bot]';

/**
 * Returns a racer's scoreboard line in `place` (0 = first), tab separated (`FinishgameGui::updateScoreBoard`).
 */
function scoreLine(racer: Racer, place: number, first: number, kills: number): string {
    if (racer.finishTime === null) return 'running';
    const prize = placePrize(first, place + 1);
    // The trailing spaces after some prizes are in the original and push the kills column right.
    let prizeText = `$${prize}`;
    if (place === 2 && prize < 1000) prizeText += ' ';
    else if (place > 2) prizeText += '      ';
    const killText = kills < 0 ? `-$${-kills * KILL_VALUE}` : `$${kills * KILL_VALUE}`;
    return [...lapSplits(racer), formatRaceTime(racer.finishTime), prizeText, killText].join('\t');
}

/**
 * Returns each lap's own time.
 */
function lapSplits(racer: Racer): string[] {
    const out: string[] = [];
    let previous = 0;
    for (let i = 0; i < 3; i++) {
        const end = racer.lapTimes[i] ?? previous;
        // Rounded to whole milliseconds, so that float error cannot drop a tenth (6.1 - 5.4 is 0.69999...).
        out.push(formatRaceTime(Math.round((end - previous) * 1000) / 1000));
        previous = end;
    }
    return out;
}

/** Torque draws a tab as a gap of this many spaces, not as a jump to a column (`GFont::TabWidthInSpaces`). */
const TAB_WIDTH_IN_SPACES = 3;

/**
 * Shows `text` the way a Torque text control draws it.
 */
function setTorqueText(element: HTMLElement, text: string): void {
    element.textContent = text.split('\t').join(' '.repeat(TAB_WIDTH_IN_SPACES));
}
