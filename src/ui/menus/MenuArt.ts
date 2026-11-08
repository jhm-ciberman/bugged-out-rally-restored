import { CARS } from '../../game/CarCatalog';
import { TRACK_NAMES } from '../../game/Tracks';
import { preloadButtonArt, preloadPicture } from '../GuiControls';

/** The full-screen menu backgrounds. The main menu is first because it opens first. */
const BACKGROUNDS = [
    'mainmenu.jpg',
    'playerselection.jpg',
    'venueselection.jpg',
    'loadselection.jpg',
    'optionsselection.jpg',
    'controlview.jpg',
    'aboutpage.jpg',
    'advpage.jpg',
];

/** The buttons of all menus and of the finish screen. The main menu's are first. */
const BUTTONS = [
    'start',
    'about',
    'options',
    'quit',
    'accept',
    'add',
    'back',
    'buttons/enter',
    'buttons/left',
    'buttons/ok',
    'buttons/right',
    'cancel',
    'control',
    'del',
    'getmoregame',
    'launch',
    'online',
    'singleplayer',
];

/** The pictures placed on top of the menu and finish screen backgrounds, other than the car and track ones. */
const PICTURES = [
    'event_freerun.jpg',
    'event_single.jpg',
    'event_world.jpg',
    'hudfill.png',
    'ingamegui_n.png',
    'noteblock.png',
    'ridelocked.png',
    'safcheck.png',
    'scoreboard_n.png',
];

/**
 * Starts loading and decoding the art of every menu in the background, so a menu shows its pictures as soon as it
 * opens. A picture that fails to load is skipped.
 */
export function preloadMenuArt(): void {
    const tracks = TRACK_NAMES.map((_, index) => `track${index + 1}.jpg`);
    const cars = CARS.map((car) => car.loadingPicture);
    for (const file of BACKGROUNDS) preloadPicture(`client/ui/${file}`);
    for (const bitmap of BUTTONS) preloadButtonArt(bitmap);
    for (const file of [...PICTURES, ...tracks, ...cars]) preloadPicture(`client/ui/${file}`);
}
