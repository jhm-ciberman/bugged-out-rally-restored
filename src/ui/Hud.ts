import { assetUrl } from '../assets/AssetPaths';
import { ChatHud } from './ChatHud';
import { arialFont, guiPx } from './GuiControls';
import { type GuiRect, hudScale, placeControl, scaleAnchoredRect } from './GuiLayout';

const ui = (file: string) => assetUrl(`client/ui/${file}`);

/** Controls of `PlayGui.gui`, in draw order. */
const RECTS = {
    centerPrint: { x: 200, y: 140, w: 400, h: 20, horiz: 'center', vert: 'relative' },
    health: { x: 200, y: 0, w: 200, h: 35, horiz: 'relative', vert: 'relative' },
    counter: { x: 210, y: 170, w: 380, h: 260, horiz: 'center', vert: 'center' },
    energy: { x: 400, y: 0, w: 200, h: 35, horiz: 'relative', vert: 'relative' },
    lapPos: { x: 645, y: 5, w: 131, h: 24, horiz: 'left', vert: 'bottom' },
    lapTime: { x: 645, y: 32, w: 127, h: 24, horiz: 'left', vert: 'bottom' },
    speedometer: { x: 339, y: 514, w: 121, h: 85, horiz: 'center', vert: 'top' },
    healthFrame: { x: 200, y: 0, w: 200, h: 35, horiz: 'relative', vert: 'relative' },
    energyFrame: { x: 400, y: 0, w: 200, h: 35, horiz: 'relative', vert: 'relative' },
    zingerIcon: { x: 725, y: 444, w: 58, h: 63, horiz: 'left', vert: 'top' },
    zingCount: { x: 719, y: 489, w: 11, h: 24, horiz: 'left', vert: 'top' },
    bombIcon: { x: 725, y: 517, w: 60, h: 63, horiz: 'left', vert: 'top' },
    bombCount: { x: 720, y: 561, w: 11, h: 24, horiz: 'left', vert: 'top' },
} satisfies Record<string, GuiRect>;

/** The directional arrow viewport (`DirectionalArrow`, a `GuiObjectView`). */
export const ARROW_RECT: GuiRect = { x: 349, y: 45, w: 106, h: 83, horiz: 'relative', vert: 'relative' };

/** Speedometer needle settings (`GuiSpeedometerHud` in PlayGui.gui). */
const SPEEDO = { maxSpeed: 100, minAngle: 215, maxAngle: -70, centerX: 60, centerY: 55, length: 40, width: 2 };
/** Health bar pulse: period in ms and the level below which it pulses. */
const PULSE_MS = 1000;
const PULSE_THRESHOLD = 0.5;
/** The renderer never draws the damage flash stronger than this (`renderWorld`). */
const MAX_FLASH_OPACITY = 0.76;
/** The color laid over the whole screen while the camera is under water, measured from the original. */
const UNDERWATER_TINT = 'rgba(51, 153, 179, 0.45)';

/**
 * Values shown on the HUD, refreshed every frame.
 */
export interface HudState {
    /** Remaining health, 0 to 1. */
    health: number;
    /** Boost energy, 0 to 1. */
    energy: number;
    /** Speed in meters per second. */
    speed: number;
    position: number;
    /** Lap shown to the player, starting at 1. */
    lap: number;
    /** Race time in seconds. */
    time: number;
    rockets: number;
    bombs: number;
    /** Strength of the red damage flash, 0 for none. */
    damageFlash: number;
}

/**
 * The in-race HUD (`PlayGui.gui`), rebuilt as HTML over the 3D view.
 */
export class Hud {
    readonly element = document.createElement('div');
    /** The message log, a dialog drawn over the HUD. */
    readonly chat = new ChatHud();
    private readonly _parts = new Map<keyof typeof RECTS, HTMLElement>();
    private readonly _healthFill = document.createElement('div');
    private readonly _energyFill = document.createElement('div');
    private readonly _needle = document.createElement('div');
    private readonly _counter = document.createElement('img');
    private readonly _centerText = document.createElement('div');
    /** Red layer over the 3D view after a hit; the HUD controls draw on top of it. */
    private readonly _flash = document.createElement('div');
    /** Water color over everything, HUD included, while the camera is under water. */
    private readonly _underwater = document.createElement('div');
    private _centerTimer = 0;
    private _counterTimer = 0;

    constructor(parent: HTMLElement) {
        const e = this.element;
        e.className = 'hud';
        Object.assign(e.style, {
            position: 'absolute',
            inset: '0',
            pointerEvents: 'none',
            overflow: 'hidden',
            isolation: 'isolate',
        });
        Object.assign(this._flash.style, {
            position: 'absolute',
            inset: '0',
            background: 'rgb(255, 0, 0)',
            opacity: '0',
        });
        e.append(this._flash);

        const centerPrint = this._add('centerPrint', 'div');
        centerPrint.style.background = `url(${ui('hudfill.png')}) center / 100% 100%`;
        centerPrint.style.display = 'none';
        Object.assign(this._centerText.style, {
            font: arialFont(14),
            color: 'rgb(0, 255, 0)',
            textAlign: 'center',
            lineHeight: guiPx(20),
        });
        centerPrint.append(this._centerText);

        const health = this._add('health', 'div');
        health.style.background = 'rgba(0, 0, 0, 0.5)';
        Object.assign(this._healthFill.style, { height: '100%', background: 'rgb(230, 26, 26)' });
        health.append(this._healthFill);

        this._counter.src = ui('go.png');
        this._counter.style.display = 'none';
        this._parts.set('counter', this._counter);
        e.append(this._counter);

        const energy = this._add('energy', 'div');
        energy.style.background = 'rgba(0, 0, 0, 0.5)';
        Object.assign(this._energyFill.style, { height: '100%', background: 'rgba(0, 230, 230, 0.1)' });
        energy.append(this._energyFill);

        for (const key of ['lapPos', 'lapTime', 'zingCount', 'bombCount'] as const) {
            const t = this._add(key, 'div');
            Object.assign(t.style, {
                font: arialFont(24, true),
                color: 'rgb(255, 192, 55)',
                textShadow: `${guiPx(1)} ${guiPx(1)} 0 #000`,
                whiteSpace: 'pre',
                lineHeight: guiPx(24),
            });
        }

        const speedo = this._add('speedometer', 'div');
        speedo.style.background = `url(${ui('speedometer2.png')}) center / 100% 100%`;
        Object.assign(this._needle.style, {
            position: 'absolute',
            left: guiPx(SPEEDO.centerX),
            top: guiPx(SPEEDO.centerY - SPEEDO.width),
            width: guiPx(SPEEDO.length),
            height: guiPx(SPEEDO.width * 2),
            boxSizing: 'border-box',
            border: `${guiPx(1)} solid rgb(255, 77, 77)`,
            transformOrigin: `0 ${guiPx(SPEEDO.width)}`,
        });
        speedo.append(this._needle);

        for (const [key, file] of [
            ['healthFrame', 'healthmeter.png'],
            ['energyFrame', 'healthmeter.png'],
            ['zingerIcon', 'zingergui.png'],
            ['bombIcon', 'bombicon.png'],
        ] as const) {
            const img = this._add(key, 'img') as HTMLImageElement;
            img.src = ui(file);
        }
        // Draw the counts above their icons, like the GUI file order (count after icon).
        for (const key of ['zingCount', 'bombCount'] as const) e.append(this._parts.get(key)!);
        e.append(this.chat.element);
        Object.assign(this._underwater.style, {
            position: 'absolute',
            inset: '0',
            zIndex: '1',
            background: UNDERWATER_TINT,
            display: 'none',
        });
        e.append(this._underwater);

        parent.append(e);
        this.resize(window.innerWidth, window.innerHeight);
    }

    /**
     * Lays the controls out for a screen of `width` x `height` pixels.
     */
    resize(width: number, height: number): void {
        const scale = hudScale(height);
        this.element.style.setProperty('--gui-scale', String(scale));
        for (const [key, el] of this._parts) placeControl(el, scaleAnchoredRect(RECTS[key], scale), width, height);
        this.chat.resize(width, scale);
    }

    /**
     * Shows or hides the water color over the screen.
     */
    setUnderwater(underwater: boolean): void {
        this._underwater.style.display = underwater ? '' : 'none';
    }

    /**
     * Shows a number of the start countdown (3, 2, 1), or the "go" sign for 0, which hides after a second.
     */
    showCountdown(value: number): void {
        this._counter.src = ui(value > 0 ? `${value}.png` : 'go.png');
        this._counter.style.display = '';
        this._counterTimer = value > 0 ? Number.POSITIVE_INFINITY : 1;
    }

    /**
     * Shows `text` in the center message box for `seconds`.
     */
    centerPrint(text: string, seconds = 1): void {
        this._centerText.textContent = text;
        this._parts.get('centerPrint')!.style.display = '';
        this._centerTimer = seconds;
    }

    /**
     * Refreshes the HUD values and timers.
     */
    update(state: HudState, deltaSeconds: number): void {
        this._centerTimer -= deltaSeconds;
        if (this._centerTimer <= 0) this._parts.get('centerPrint')!.style.display = 'none';
        this._counterTimer -= deltaSeconds;
        if (this._counterTimer <= 0) this._counter.style.display = 'none';

        const health = Math.max(0, Math.min(1, state.health));
        this._healthFill.style.width = `${health * 100}%`;
        let alpha = 1;
        if (health < PULSE_THRESHOLD) {
            const t = (performance.now() % PULSE_MS) / (PULSE_MS / 2);
            alpha = t > 1 ? 2 - t : t;
        }
        this._healthFill.style.opacity = String(alpha);
        this._energyFill.style.width = `${Math.max(0, Math.min(1, state.energy)) * 100}%`;
        this._flash.style.opacity = String(Math.min(state.damageFlash, MAX_FLASH_OPACITY));

        this._parts.get('lapPos')!.textContent = `Pos: ${state.position}  Lap: ${state.lap}`;
        this._parts.get('lapTime')!.textContent = `Time: ${formatRaceTime(state.time)}`;
        this._parts.get('zingCount')!.textContent = String(state.rockets);
        this._parts.get('bombCount')!.textContent = String(state.bombs);

        const speed = Math.min(state.speed, SPEEDO.maxSpeed);
        const angle = SPEEDO.minAngle + (SPEEDO.maxAngle - SPEEDO.minAngle) * (speed / SPEEDO.maxSpeed);
        // The engine turns the needle counterclockwise on screen for positive angles; CSS turns clockwise.
        this._needle.style.transform = `rotate(${-angle}deg)`;
    }

    private _add(key: keyof typeof RECTS, tag: 'div' | 'img'): HTMLElement {
        const el = document.createElement(tag);
        this._parts.set(key, el);
        this.element.append(el);
        return el;
    }
}

/**
 * Formats a race time as `mm:ss.t`, like the HUD clock.
 */
export function formatRaceTime(seconds: number): string {
    const tenths = Math.floor(seconds * 10);
    const m = Math.floor(tenths / 600);
    const s = Math.floor((tenths % 600) / 10);
    const t = tenths % 10;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${t}`;
}
