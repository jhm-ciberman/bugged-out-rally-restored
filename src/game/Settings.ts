const STORAGE_KEY = 'bor.settings';

/**
 * Player preferences from the options menu.
 */
export interface Settings {
    /** Music and menu sounds, 0 to 1 (`$pref::Audio::channelVolume1`). */
    musicVolume: number;
    /** World sounds, 0 to 1 (`$pref::Audio::channelVolume2`). */
    soundVolume: number;
    /** Mouse steering multiplier, 0.2 to 1 (`$pref::Input::LinkMouseSensitivity`). */
    mouseSensitivity: number;
    /** Rendering resolution as a share of the screen's pixels; `native` uses every device pixel. */
    renderQuality: 'low' | 'medium' | 'high' | 'native';
    /** Texture sharpness at a distance, from 0 (High) to 3 (V.Low) on the Texture Detail menu. */
    textureDetail: number;
    /** Opens every bug and track, whatever the player's winnings. */
    unlockAll: boolean;
}

/**
 * The defaults: channel volumes from `client/defaults.cs`, and the mouse sensitivity a played install had saved
 * (the game's own default is 1, which steers much harder).
 */
const DEFAULTS: Settings = {
    musicVolume: 0.8,
    soundVolume: 0.8,
    mouseSensitivity: 0.2,
    renderQuality: 'high',
    textureDetail: 0,
    unlockAll: false,
};

/** Share of the screen's pixel ratio (at most 2) each render quality draws at. */
const RENDER_SCALE: Record<Exclude<Settings['renderQuality'], 'native'>, number> = { low: 0.5, medium: 0.75, high: 1 };

/**
 * Returns the pixel ratio to render at for the current settings.
 */
export function renderPixelRatio(): number {
    const quality = getSettings().renderQuality;
    if (quality === 'native') return window.devicePixelRatio;
    return Math.min(window.devicePixelRatio, 2) * (RENDER_SCALE[quality] ?? 1);
}

/**
 * Returns the anisotropic filtering level for the texture detail setting.
 */
export function textureAnisotropy(): number {
    return [8, 4, 2, 1][getSettings().textureDetail] ?? 8;
}

let current: Settings | null = null;

/**
 * Returns the current settings, loading them on first use.
 */
export function getSettings(): Settings {
    if (!current) {
        current = { ...DEFAULTS };
        try {
            Object.assign(current, JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
        } catch {
            // Unreadable or unavailable storage: keep the defaults.
        }
    }
    return current;
}

/**
 * Changes some settings and saves them.
 */
export function updateSettings(changes: Partial<Settings>): void {
    Object.assign(getSettings(), changes);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
        // Storage unavailable: the change lasts for this visit.
    }
}
