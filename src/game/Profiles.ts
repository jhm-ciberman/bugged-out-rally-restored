/** Most saved players (the three slots of the player selection menu). */
export const MAX_PROFILES = 3;
/** Longest player name (`EditName` max length). */
export const MAX_NAME_LENGTH = 8;

const STORAGE_KEY = 'bor.profiles';

/**
 * A saved player (`PlayerFileObject` in the original, a `.dat` file under `bor/saves`).
 */
export interface Profile {
    name: string;
    /** Total prize money won (kill penalties can lower it); it unlocks cars. */
    points: number;
    /** Highest open track index (0 to 7) in the Single series (also used by Explore). */
    highestSingle: number;
    /** Highest open track index (0 to 7) in the Circuit series. */
    highestCircuit: number;
}

/**
 * Reads the saved players. Returns an empty list when storage is unavailable or broken.
 */
export function loadProfiles(): Profile[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const list = raw ? (JSON.parse(raw) as Profile[]) : [];
        return Array.isArray(list) ? list.slice(0, MAX_PROFILES) : [];
    } catch {
        return [];
    }
}

/**
 * Writes the saved players. Does nothing when storage is unavailable.
 */
export function saveProfiles(profiles: readonly Profile[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    } catch {
        // Private browsing or full storage: progress lasts for this visit only.
    }
}

/**
 * Creates a fresh player: no winnings, only the first track open in both series.
 */
export function newProfile(name: string): Profile {
    return { name, points: 0, highestSingle: 0, highestCircuit: 0 };
}

/**
 * Applies a race result to a player and saves it (`addPlayerWinnings` in server/scripts/game.cs):
 * adds the winnings, and a first place with at least four racers opens the next track of that series.
 *
 * @param series 1 for Single, 2 for Circuit.
 * @param trackIndex Track number minus one.
 */
export function recordResult(
    profileName: string,
    winnings: number,
    unlock: { series: 1 | 2; trackIndex: number } | null,
): void {
    const profiles = loadProfiles();
    const profile = profiles.find((p) => p.name === profileName);
    if (!profile) return;
    profile.points += winnings;
    if (unlock) {
        const next = Math.min(7, unlock.trackIndex + 1);
        if (unlock.series === 1) profile.highestSingle = Math.max(profile.highestSingle, next);
        else profile.highestCircuit = Math.max(profile.highestCircuit, next);
    }
    saveProfiles(profiles);
}
