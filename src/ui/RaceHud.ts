import type * as THREE from 'three';
import type { RaceEvent } from '../ai/BotRoster';
import type { ModelLibrary } from '../assets/ModelLibrary';
import type { AudioSystem } from '../audio/AudioSystem';
import type { Car, DamageCause } from '../game/Car';
import { RACE_LAPS, type RaceEvents } from '../game/Race';
import type { RaceSession } from '../game/RaceSession';
import { ChatColor } from './ChatHud';
import { DirectionArrow } from './DirectionArrow';
import { type FinishActions, FinishScreen } from './FinishScreen';
import { Hud } from './Hud';
import { TargetHud } from './TargetHud';

/**
 * Connects a race to the HUD, the checkpoint arrow and the countdown sounds (`client/scripts/game.cs`).
 */
export class RaceHud {
    readonly hud: Hud;
    private readonly _targets: TargetHud;
    private readonly _arrow = new DirectionArrow();
    private _session: RaceSession | null = null;

    private _finish: FinishScreen | null = null;
    private _finishTimer: ReturnType<typeof setTimeout> | null = null;
    /** Called once when the player finishes the last lap. */
    onPlayerFinished: (() => void) | null = null;
    private _refreshTimer = 0;

    constructor(
        private readonly _parent: HTMLElement,
        private readonly _audio: AudioSystem,
        private readonly _event: RaceEvent,
        private readonly _trackNumber: number,
        private readonly _finishActions: FinishActions,
    ) {
        this.hud = new Hud(_parent);
        this._targets = new TargetHud(this.hud.element);
        for (const p of ['AudioCountBeep', 'AudioGoBeep']) _audio.preload(p);
        window.addEventListener('keydown', this._onKey);
    }

    /**
     * Race callbacks that drive the HUD. Pass them to the race when creating it.
     */
    get events(): RaceEvents {
        return {
            onCountdown: (value) => {
                this.hud.showCountdown(value);
                void this._audio.play2d(value > 0 ? 'AudioCountBeep' : 'AudioGoBeep');
            },
            onFinish: (racer) => {
                // The scoreboard comes up 200 ms after the player's last lap (`onCycleExec`).
                if (racer !== this._session?.playerRacer) return;
                this.onPlayerFinished?.();
                this._finishTimer = setTimeout(() => this._showFinish(), 200);
            },
            onCenterPrint: (racer, text) => {
                if (racer === this._session?.playerRacer) this.hud.centerPrint(text);
            },
        };
    }

    /**
     * Loads the arrow model and starts showing `session`.
     */
    async attach(session: RaceSession, models: ModelLibrary): Promise<void> {
        this._session = session;
        const chat = this.hud.chat;
        // The player connects before the bots, as the original shows it.
        chat.addLine(`Welcome to the game ${session.playerRacer.name}.`, ChatColor.notice);
        for (const bot of session.bots) chat.addLine(`${bot.racer.name} joined the game.`, ChatColor.join);
        session.onScoredWreck = (car, cause) => chat.addLine(wreckMessage(session, car, cause));
        // Ammo pickups play where the item was, for every car (`ammo::onPickup` uses ServerPlay3D).
        session.pickups.onPickup = ({ car, kind, position }) => {
            if (kind !== 'health') void this._audio.play3d('AmmoPickupSound', position, session.combat.object);
            if (car !== session.player) return;
            if (kind === 'health') chat.addLine('Gained Health', ChatColor.notice);
            else chat.addLine(`You picked up ${kind === 'rocket' ? 'a Zinger Ammo' : 'a Magno Bomb'}`);
        };
        await this._arrow.load(models);
    }

    update(deltaSeconds: number): void {
        const s = this._session;
        if (!s) return;
        if (this._finish) {
            this._refreshTimer -= deltaSeconds;
            if (this._refreshTimer <= 0) {
                this._refreshTimer = 0.5;
                this._finish.refresh();
            }
        }
        const v = s.player.vehicle;
        const racer = s.playerRacer;
        this.hud.update(
            {
                health: s.player.health,
                energy: v.data.maxEnergy > 0 ? v.energy / v.data.maxEnergy : 0,
                speed: v.speed,
                position: s.race.positionOf(racer),
                lap: Math.min(racer.lap + 1, RACE_LAPS),
                time: racer.finishTime ?? s.race.time,
                rockets: s.player.rockets,
                bombs: s.player.bombs,
                damageFlash: s.player.damageFlash,
            },
            deltaSeconds,
        );
    }

    /**
     * Draws the checkpoint arrow over the frame that was just rendered with `camera`.
     */
    render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
        const s = this._session;
        if (!s || this._finish) {
            this._targets.hide();
            return;
        }
        this._targets.render(s, camera, s.cameraFov, window.innerWidth, window.innerHeight);
        this._arrow.render(renderer, camera, s.player.renderPosition, s.race.nextCheckpointPosition(s.playerRacer));
    }

    resize(width: number, height: number): void {
        this.hud.resize(width, height);
        this._finish?.resize(width, height);
    }

    /** Whether the finish screen is up. */
    get finished(): boolean {
        return this._finish !== null;
    }

    /**
     * Removes the HUD and the finish screen.
     */
    dispose(): void {
        window.removeEventListener('keydown', this._onKey);
        if (this._finishTimer) clearTimeout(this._finishTimer);
        this._finish?.dispose();
        this._finish = null;
        this.hud.element.remove();
    }

    // Page up and page down scroll the message log (`pageMessageHudUp` in config.cs).
    private readonly _onKey = (e: KeyboardEvent): void => {
        if (e.code === 'PageUp') this.hud.chat.pageUp();
        else if (e.code === 'PageDown') this.hud.chat.pageDown();
        else return;
        e.preventDefault();
    };

    private _showFinish(): void {
        if (this._finish || !this._session) return;
        this._session.inputEnabled = false;
        document.exitPointerLock();
        this._finish = new FinishScreen(
            this._parent,
            this._session,
            this._event,
            this._trackNumber,
            this._finishActions,
        );
    }
}

/**
 * Returns the message announcing a wreck (`GameConnection::onDeath`).
 */
function wreckMessage(session: RaceSession, car: Car, cause: DamageCause): string {
    const name = session.nameOf(car);
    if (cause.kind === 'water') return `${name} drowns!`;
    if (cause.kind !== 'projectile' || cause.source === car) return `${name} wipes out!`;
    // The original names nobody for a hit from the frogs and boulders ("gets nailed by !").
    if (!cause.source) return `${name} gets nailed!`;
    return `${name} gets nailed by ${session.nameOf(cause.source)}!`;
}
