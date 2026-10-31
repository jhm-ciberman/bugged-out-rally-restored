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
}

/**
 * The defaults: channel volumes from `client/defaults.cs`, and the mouse sensitivity a played install had saved
 * (the game's own default is 1, which steers much harder).
 */
const DEFAULTS: Settings = { musicVolume: 0.8, soundVolume: 0.8, mouseSensitivity: 0.2 };

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
