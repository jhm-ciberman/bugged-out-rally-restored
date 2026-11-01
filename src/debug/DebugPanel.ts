import type { Game } from '../Game';
import { torqueFogUniforms } from '../render/TorqueFog';

/** Key that shows and hides the panel. */
const TOGGLE_KEY = 'F2';

/**
 * What the debug panel can turn off.
 */
interface DebugFlags {
    fog: boolean;
    sky: boolean;
    water: boolean;
    sunFlares: boolean;
    particles: boolean;
    hud: boolean;
}

const LABELS: Record<keyof DebugFlags, string> = {
    fog: 'Fog',
    sky: 'Sky',
    water: 'Water',
    sunFlares: 'Sun flares',
    particles: 'Particles',
    hud: 'HUD',
};

/**
 * A small development panel with switches for parts of the scene and a view distance slider, shown with F2
 * or `?debug`. `?nofog` starts with the fog off, `?view=2` with twice the view distance.
 */
export class DebugPanel {
    private readonly _element = document.createElement('div');
    private readonly _fps = document.createElement('div');
    private readonly _flags: DebugFlags = {
        fog: true,
        sky: true,
        water: true,
        sunFlares: true,
        particles: true,
        hud: true,
    };
    private readonly _viewLabel = document.createElement('div');
    private readonly _flyBox = document.createElement('input');
    private _frames = 0;
    private _lastFpsTime = performance.now();

    constructor(private readonly _game: Game) {
        const params = new URLSearchParams(window.location.search);
        if (params.has('nofog')) this._flags.fog = false;
        const view = Number(params.get('view'));
        if (Number.isFinite(view) && view > 0) _game.viewDistanceScale = view;

        Object.assign(this._element.style, {
            position: 'fixed',
            top: '8px',
            left: '8px',
            zIndex: '1000',
            padding: '8px 10px',
            background: 'rgba(0, 0, 0, 0.7)',
            color: '#fff',
            font: '12px monospace',
            borderRadius: '4px',
            display: params.has('debug') ? '' : 'none',
            pointerEvents: 'auto',
            userSelect: 'none',
        });
        const title = document.createElement('div');
        title.textContent = `Debug (${TOGGLE_KEY})`;
        title.style.fontWeight = 'bold';
        this._element.append(title, this._fps);
        for (const key of Object.keys(LABELS) as (keyof DebugFlags)[]) {
            const label = document.createElement('label');
            label.style.display = 'block';
            label.style.cursor = 'pointer';
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = this._flags[key];
            box.addEventListener('change', () => {
                this._flags[key] = box.checked;
            });
            label.append(box, ` ${LABELS[key]}`);
            this._element.append(label);
        }
        // The fly camera lives in the game, so the box mirrors it (a race starting or ending changes it too).
        const flyLabel = document.createElement('label');
        flyLabel.style.display = 'block';
        flyLabel.style.cursor = 'pointer';
        this._flyBox.type = 'checkbox';
        this._flyBox.addEventListener('change', () => {
            _game.flying = this._flyBox.checked;
        });
        flyLabel.append(this._flyBox, ' Fly camera (WASD, Q/E, Shift)');
        this._element.append(flyLabel);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0.5';
        slider.max = '12';
        slider.step = '0.5';
        slider.value = String(_game.viewDistanceScale);
        slider.style.width = '140px';
        slider.addEventListener('input', () => {
            _game.viewDistanceScale = Number(slider.value);
        });
        this._element.append(this._viewLabel, slider);
        document.body.append(this._element);

        window.addEventListener('keydown', (e) => {
            if (e.code !== TOGGLE_KEY) return;
            e.preventDefault();
            this._element.style.display = this._element.style.display === 'none' ? '' : 'none';
        });
        requestAnimationFrame(this._apply);
    }

    // Applied every frame, since each race builds a new scene.
    private readonly _apply = (): void => {
        const f = this._flags;
        torqueFogUniforms.torqueFogEnabled.value = f.fog ? 1 : 0;
        this._game.track?.root.traverse((obj) => {
            if (obj.name === 'Sky') obj.visible = f.sky;
            else if (obj.name === 'Water') obj.visible = f.water;
            else if (obj.name === 'SunFlare') obj.visible = f.sunFlares;
        });
        const particles = this._game.session?.combat.particles.object;
        if (particles) particles.visible = f.particles;
        for (const hud of document.querySelectorAll<HTMLElement>('.hud')) hud.style.visibility = f.hud ? '' : 'hidden';
        this._flyBox.checked = this._game.flying;
        const scale = this._game.viewDistanceScale;
        const meters = this._game.track ? ` (${Math.round(this._game.track.visibleDistance * scale)} m)` : '';
        this._viewLabel.textContent = `View distance ${scale}x${meters}`;

        this._frames++;
        const now = performance.now();
        if (now - this._lastFpsTime >= 500) {
            this._fps.textContent = `${Math.round((this._frames * 1000) / (now - this._lastFpsTime))} fps`;
            this._frames = 0;
            this._lastFpsTime = now;
        }
        requestAnimationFrame(this._apply);
    };
}
