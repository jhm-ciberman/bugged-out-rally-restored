import type { RaceEvent } from '../ai/BotRoster';

/** Fewest racers (player plus bots) for a race to pay prizes (`setupWinnings`). */
const MIN_RACERS_FOR_PRIZE = 4;
/** Money per kill point (`addPlayerWinnings`). */
export const KILL_VALUE = 500;

/**
 * Returns the first prize of a race (`setupWinnings` in server/scripts/game.cs).
 *
 * @param trackIndex Track number minus one (0 to 7).
 */
export function firstPrize(event: RaceEvent, trackIndex: number, racers: number): number {
    if (racers < MIN_RACERS_FOR_PRIZE || event === 'explore') return 0;
    const step = event === 'single' ? 2000 : 4000;
    return trackIndex > 7 ? step * 5 : step * (trackIndex + 1);
}

/**
 * Returns the prize for finishing in `place` (1 = first): full, half, quarter, then nothing (`addPlayerWinnings`).
 */
export function placePrize(first: number, place: number): number {
    if (place === 1) return first;
    if (place === 2) return first * 0.5;
    if (place === 3) return first * 0.25;
    return 0;
}
