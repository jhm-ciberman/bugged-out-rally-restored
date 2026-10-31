/**
 * A car on the player selection menu.
 */
export interface CarEntry {
    /** Name shown on the menu. */
    readonly label: string;
    /** The vehicle datablock the car races with. */
    readonly datablock: string;
    /** The show model on the menu turntable. */
    readonly showShape: string;
    /** Picture on the loading screen, under `client/ui/`. */
    readonly loadingPicture: string;
    /** Total winnings needed to drive it. */
    readonly price: number;
}

/** The eight bugs in menu order, with their prices (`playerSelectionMenu::onWake`). */
export const CARS: readonly CarEntry[] = [
    car('Beetle', 'Beetle', 'beetle', 'beetle_running', 0),
    car('Ladybug', 'LadyBug', 'ladybug', 'ladybug_running', 10000),
    car('Cockroach', 'Cockroach', 'cockroach', 'cockroach_running', 25000),
    car('Grasshopper', 'Grasshopper', 'grasshopper', 'grasshopper_running', 50000),
    car('Hornet', 'Hornet', 'hornet', 'hornet_running', 100000),
    car('Praying Mantis', 'Prayingmantis', 'prayingmantis', 'pmantis_running', 150000),
    car('Scorpion', 'Scorpion', 'scorpion', 'scorpion_running', 200000),
    car('BlackWidow', 'Blackwidow', 'blackwidow', 'blkwidow_running', 300000),
];

function car(label: string, datablock: string, shape: string, picture: string, price: number): CarEntry {
    return {
        label,
        datablock,
        showShape: `~/data/shapes/car/${shape}show.dts`,
        loadingPicture: `${picture}.png`,
        price,
    };
}

/**
 * Whether a player with `winnings` may drive `car`. The first car is always open.
 */
export function isCarUnlocked(car: CarEntry, winnings: number): boolean {
    return car === CARS[0] || winnings >= car.price;
}
