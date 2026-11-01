import { getSettings, updateSettings } from '../game/Settings';

/**
 * An action the player can bind to a key or mouse button on the controls menu.
 */
export type Action =
    | 'throttle'
    | 'reverse'
    | 'turnLeft'
    | 'turnRight'
    | 'brake'
    | 'fire'
    | 'drop'
    | 'altThrottle'
    | 'altReverse'
    | 'altFire'
    | 'altDrop'
    | 'zoom'
    | 'firstPerson';

/**
 * The remappable actions in menu order with their names (`$RemapName` in optionsMenu.cs).
 */
export const ACTIONS: readonly { readonly action: Action; readonly name: string }[] = [
    { action: 'throttle', name: 'Throttle' },
    { action: 'reverse', name: 'Reverse' },
    { action: 'turnLeft', name: 'Turn Left' },
    { action: 'turnRight', name: 'Turn Right' },
    { action: 'brake', name: 'Brake' },
    { action: 'fire', name: 'Fire Zinger' },
    { action: 'drop', name: 'Drop Bomb' },
    { action: 'altThrottle', name: 'Alt Throttle' },
    { action: 'altReverse', name: 'Alt Reverse' },
    { action: 'altFire', name: 'Alt Fire Zinger' },
    { action: 'altDrop', name: 'Alt Drop Bomb' },
    { action: 'zoom', name: 'Toggle Zoom' },
    { action: 'firstPerson', name: 'Switch 1st/3rd' },
];

/**
 * The bindings of a fresh install (`config.cs`). Keys are `KeyboardEvent.code` values, mouse buttons are
 * `Mouse` plus Torque's button number (0 left, 1 right, 2 middle).
 */
export const DEFAULT_BINDINGS: Readonly<Record<Action, string>> = {
    throttle: 'ArrowUp',
    reverse: 'ArrowDown',
    turnLeft: 'ArrowLeft',
    turnRight: 'ArrowRight',
    brake: 'Space',
    fire: 'KeyA',
    drop: 'KeyD',
    altThrottle: 'KeyW',
    altReverse: 'KeyS',
    altFire: 'Mouse0',
    altDrop: 'Mouse1',
    zoom: 'KeyE',
    firstPerson: 'Tab',
};

/**
 * Returns the input bound to `action`, or `null` when the player cleared it.
 */
export function bindingOf(action: Action): string | null {
    const custom = getSettings().keyBindings;
    return action in custom ? (custom[action] ?? null) : DEFAULT_BINDINGS[action];
}

/**
 * Returns the action `input` triggers, if any.
 */
export function actionOf(input: string): Action | null {
    return ACTIONS.find(({ action }) => bindingOf(action) === input)?.action ?? null;
}

/**
 * Binds `input` to `action` and saves it. Another action that used `input` loses its binding, since one
 * input triggers one action.
 */
export function bind(action: Action, input: string): void {
    const bindings = { ...getSettings().keyBindings };
    const previous = actionOf(input);
    if (previous && previous !== action) bindings[previous] = null;
    bindings[action] = input;
    updateSettings({ keyBindings: bindings });
}

/**
 * Returns how the controls menu shows `input`: Torque's lower case key names, and mouse buttons counted from 1.
 */
export function inputName(input: string | null): string {
    if (!input) return '';
    const mouse = /^Mouse(\d)$/.exec(input);
    if (mouse) return `mouse${Number(mouse[1]) + 1}`;
    const name = input
        .replace(/^Key/, '')
        .replace(/^Digit/, '')
        .replace(/^Arrow/, '')
        .replace(/^Numpad/, 'numpad ');
    return name.toLowerCase();
}
