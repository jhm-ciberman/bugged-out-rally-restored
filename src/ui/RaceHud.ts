import type * as THREE from 'three';
import type { ModelLibrary } from '../assets/ModelLibrary';
import type { AudioSystem } from '../audio/AudioSystem';
import { RACE_LAPS, type RaceEvents } from '../game/Race';
import type { RaceSession } from '../game/RaceSession';
import { DirectionArrow } from './DirectionArrow';
import { Hud } from './Hud';

/**
 * Connects a race to the HUD, the checkpoint arrow and the countdown sounds (`client/scripts/game.cs`).
 */
export class RaceHud {
    readonly hud: Hud;
    private readonly _arrow = new DirectionArrow();
    private _session: RaceSession | null = null;

    constructor(
        parent: HTMLElement,
        private readonly _audio: AudioSystem,
    ) {
        this.hud = new Hud(parent);
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
        await this._arrow.load(models);
    }

    update(deltaSeconds: number): void {
        const s = this._session;
        if (!s) return;
        const v = s.player.vehicle;
        const racer = s.playerRacer;
        this.hud.update(
            {
                health: 1,
                energy: v.data.maxEnergy > 0 ? v.energy / v.data.maxEnergy : 0,
                speed: v.speed,
                position: s.race.positionOf(racer),
                lap: Math.min(racer.lap + 1, RACE_LAPS),
                time: racer.finishTime ?? s.race.time,
                rockets: 0,
                bombs: 0,
            },
            deltaSeconds,
        );
    }

    /**
     * Draws the checkpoint arrow over the frame that was just rendered with `camera`.
     */
    render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
        const s = this._session;
        if (!s) return;
        this._arrow.render(renderer, camera, s.player.renderPosition, s.race.nextCheckpointPosition(s.playerRacer));
    }

    resize(width: number, height: number): void {
        this.hud.resize(width, height);
    }
}
