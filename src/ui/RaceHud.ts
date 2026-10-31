import type * as THREE from 'three';
import type { RaceEvent } from '../ai/BotRoster';
import type { ModelLibrary } from '../assets/ModelLibrary';
import type { AudioSystem } from '../audio/AudioSystem';
import { RACE_LAPS, type RaceEvents } from '../game/Race';
import type { RaceSession } from '../game/RaceSession';
import { DirectionArrow } from './DirectionArrow';
import { type FinishActions, FinishScreen } from './FinishScreen';
import { Hud } from './Hud';

/**
 * Connects a race to the HUD, the checkpoint arrow and the countdown sounds (`client/scripts/game.cs`).
 */
export class RaceHud {
    readonly hud: Hud;
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
        for (const p of ['AudioCountBeep', 'AudioGoBeep']) _audio.preload(p);
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
        session.pickups.onPickup = ({ car, kind }) => {
            if (car === session.player && kind !== 'health') void this._audio.play2d('AmmoPickupSound');
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
            },
            deltaSeconds,
        );
    }

    /**
     * Draws the checkpoint arrow over the frame that was just rendered with `camera`.
     */
    render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
        const s = this._session;
        if (!s || this._finish) return;
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
        if (this._finishTimer) clearTimeout(this._finishTimer);
        this._finish?.dispose();
        this._finish = null;
        this.hud.element.remove();
    }

    private _showFinish(): void {
        if (this._finish || !this._session) return;
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
