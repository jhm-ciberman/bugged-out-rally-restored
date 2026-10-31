/**
 * The race events of the original game (`$Game::EventSelection`).
 */
export type RaceEvent = 'explore' | 'single' | 'circuit';

/**
 * A computer opponent: the car it drives and the name shown for it.
 */
export interface BotEntry {
    readonly car: string;
    readonly name: string;
}

/** Bots per event (`startGame` in server/scripts/game.cs). */
const BOT_COUNT: Record<RaceEvent, number> = { explore: 0, single: 3, circuit: 5 };

/**
 * Returns the opponents for an event, given the player's total winnings (`GameConnection::onConnect`
 * in common/server/clientConnection.cs). Richer players face faster bugs.
 */
export function botRoster(event: RaceEvent, winnings: number): BotEntry[] {
    let table: BotEntry[];
    if (event === 'single') {
        if (winnings < 50000) {
            table = [
                { car: 'Grasshopper', name: 'gHopper' },
                { car: 'Cockroach', name: 'cRoach' },
                { car: 'LadyBug', name: 'Ladybug' },
            ];
        } else if (winnings < 100000) {
            table = [
                { car: 'Prayingmantis', name: 'pMantis' },
                { car: 'Grasshopper', name: 'gHopper' },
                { car: 'Cockroach', name: 'cRoach' },
            ];
        } else {
            table = [
                { car: 'Scorpion', name: 'Scorpion' },
                { car: 'Prayingmantis', name: 'pMantis' },
                { car: 'Cockroach', name: 'cRoach' },
            ];
        }
    } else if (winnings < 100000) {
        table = [
            { car: 'Prayingmantis', name: 'pMantis' },
            { car: 'Hornet', name: 'Hornet' },
            { car: 'Grasshopper', name: 'Hopper' },
            { car: 'Cockroach', name: 'cRoach' },
            { car: 'LadyBug', name: 'Ladybug' },
        ];
    } else {
        table = [
            { car: 'Scorpion', name: 'Scorpion' },
            { car: 'Blackwidow', name: 'bWidow' },
            { car: 'Prayingmantis', name: 'pMantis' },
            { car: 'Grasshopper', name: 'Hopper' },
            { car: 'Cockroach', name: 'Roach' },
        ];
    }
    return table.slice(0, BOT_COUNT[event]);
}
