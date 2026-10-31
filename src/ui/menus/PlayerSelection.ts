import type { ModelLibrary } from '../../assets/ModelLibrary';
import { CARS, type CarEntry, isCarUnlocked } from '../../game/CarCatalog';
import {
    loadProfiles,
    MAX_NAME_LENGTH,
    MAX_PROFILES,
    newProfile,
    type Profile,
    saveProfiles,
} from '../../game/Profiles';
import { ABOUT_TEXT, MEDIUM_RED_TEXT, MEDIUM_TEXT, SAFARI_ARRAY_TEXT, SHADOW } from '../GuiControls';
import { MenuScreen, rel640 } from './MenuScreen';
import { ModelView } from './ModelView';
import { promptOk } from './PromptOk';

/** Default name of a new player. */
const DEFAULT_NAME = 'Roach';
/** Top of each slot row and its height, in 640x480 design pixels. */
const SLOT_ROWS = [
    { y: 108, h: 28 },
    { y: 136, h: 28 },
    { y: 164, h: 32 },
];

/**
 * What the player picked.
 */
export interface PlayerChoice {
    readonly profile: Profile;
    readonly car: CarEntry;
}

/**
 * The player selection menu (`playerSelectionMenu.gui`): three save slots and the car carousel.
 * Cars unlock with total winnings.
 */
export class PlayerSelection extends MenuScreen {
    private _profiles: Profile[] = loadProfiles();
    private _slot = 0;
    private _car = 0;
    private _editing = false;
    private readonly _rows: { name: HTMLElement; cover: HTMLElement }[] = [];
    private readonly _playerName: HTMLElement;
    private readonly _playerPoints: HTMLElement;
    private readonly _rideName: HTMLElement;
    private readonly _rideLocked: HTMLImageElement;
    private readonly _vehiclePrice: HTMLElement;
    private readonly _edit: HTMLInputElement;
    private readonly _view: ModelView;

    constructor(
        models: ModelLibrary,
        private readonly _parent: HTMLElement,
        private readonly _onBack: () => void,
        private readonly _onAccept: (choice: PlayerChoice) => void,
    ) {
        super('playerselection.jpg');
        this.button('back', rel640(480, 420, 76, 24), () => this._onBack());
        this._playerName = this.text('', MEDIUM_RED_TEXT, rel640(96, 40, 208, 24), { textShadow: SHADOW });
        this._playerPoints = this.text('', MEDIUM_RED_TEXT, rel640(36, 60, 208, 24), { textShadow: SHADOW });
        this.button('accept', rel640(60, 420, 76, 24), () => void this._accept());
        this.button('buttons/left', rel640(356, 220, 24, 24), () => this._showCar(this._car - 1));
        this.button('buttons/right', rel640(556, 220, 24, 24), () => this._showCar(this._car + 1));

        this._view = new ModelView(models);
        this.add(this._view.element, rel640(372, 60, 192, 156));
        this._rideLocked = this.image('ridelocked.png', rel640(372, 60, 192, 156));
        this._vehiclePrice = this.text('', MEDIUM_RED_TEXT, rel640(376, 60, 192, 36));
        this._rideName = this.text('', MEDIUM_TEXT, rel640(380, 220, 176, 24), { textAlign: 'center' });

        SLOT_ROWS.forEach((row, i) => {
            const box = this.add(document.createElement('div'), rel640(40, row.y, 240, row.h));
            box.style.cursor = 'pointer';
            const name = document.createElement('div');
            Object.assign(name.style, { ...SAFARI_ARRAY_TEXT, position: 'absolute', inset: '0', lineHeight: '1.2' });
            const cover = document.createElement('div');
            // `hudfill` darkens rows that are not selected; `greenclear` tints every row.
            Object.assign(cover.style, { position: 'absolute', inset: '0', background: 'rgba(0, 0, 0, 0.39)' });
            const green = document.createElement('div');
            Object.assign(green.style, { position: 'absolute', inset: '0', background: 'rgba(0, 255, 0, 0.5)' });
            box.append(name, cover, green);
            box.addEventListener('click', () => this._selectSlot(i));
            this._rows.push({ name, cover });
        });

        this._edit = this.add(document.createElement('input'), rel640(40, 164, 240, 29));
        this._edit.maxLength = MAX_NAME_LENGTH;
        Object.assign(this._edit.style, {
            ...MEDIUM_TEXT,
            background: '#fff',
            border: '1px solid rgb(255, 192, 55)',
            display: 'none',
            boxSizing: 'border-box',
        });
        this._edit.addEventListener('keydown', (e) => {
            if (e.code === 'Enter') this._finishAdd();
        });

        this.button('add', rel640(32, 220, 76, 24), () => this._startAdd());
        this.button('del', rel640(112, 220, 80, 24), () => this._delete());
        this.button('buttons/enter', rel640(196, 220, 80, 24), () => this._finishAdd());
        this.image('noteblock.png', rel640(36, 249, 248, 125));
        this.image('noteblock.png', rel640(350, 249, 247, 125));
        this.marginText(
            'Click on the slot to select the player name.\nPress Add to create a new user and click Enter to finish editing.\nTo delete a slot, select the slot and press Del.',
            ABOUT_TEXT,
            rel640(49, 263, 214, 96),
        );
        this.marginText(
            'Select different bugs by pressing the left or right arrows.\nEarn money to unlock the bugs.',
            ABOUT_TEXT,
            rel640(362, 281, 214, 48),
        );

        // Every visit starts on the first slot and the first bug.
        this._refreshRows();
        this._selectSlot(0);
        this._showCar(0);
    }

    override dispose(): void {
        this._view.dispose();
        super.dispose();
    }

    private get _profile(): Profile | null {
        return this._profiles[this._slot] ?? null;
    }

    private _refreshRows(): void {
        this._rows.forEach((row, i) => {
            row.name.textContent = this._profiles[i]?.name ?? '';
        });
    }

    private _selectSlot(slot: number): void {
        if (this._editing) return;
        this._slot = Math.min(slot, this._profiles.length - 1);
        const p = this._profile;
        this._rows.forEach((row, i) => {
            row.cover.style.display = i === this._slot ? 'none' : '';
        });
        this._playerName.textContent = p?.name ?? '';
        this._playerPoints.textContent = p ? `Winnings: $${p.points}` : '';
        this._showCar(this._car);
    }

    private _showCar(index: number): void {
        this._car = (index + CARS.length) % CARS.length;
        const car = CARS[this._car];
        void this._view.show(car.showShape);
        this._rideName.textContent = car.label;
        const open = isCarUnlocked(car, this._profile?.points ?? 0);
        this._rideLocked.style.display = open ? 'none' : '';
        this._vehiclePrice.style.display = open ? 'none' : '';
        this._vehiclePrice.textContent = `Winnings: $${car.price}`;
    }

    private _startAdd(): void {
        if (this._editing || this._profiles.length >= MAX_PROFILES) return;
        this._editing = true;
        const row = this._profiles.length;
        this._rows.forEach((r, i) => {
            r.cover.style.display = i === row ? 'none' : '';
        });
        this.move(this._edit, rel640(40, SLOT_ROWS[row].y, 240, 29));
        this._edit.value = DEFAULT_NAME;
        this._edit.style.display = '';
        this._edit.focus();
        this._edit.select();
        this._playerName.textContent = DEFAULT_NAME;
        this._playerPoints.textContent = 'Winnings: $0';
    }

    private _finishAdd(): void {
        if (!this._editing) return;
        const name = this._edit.value.trim().slice(0, MAX_NAME_LENGTH);
        this._editing = false;
        this._edit.style.display = 'none';
        // The original had no duplicate check; two saves with one name would share a file, so refuse it.
        if (name && !this._profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
            this._profiles.push(newProfile(name));
            saveProfiles(this._profiles);
        }
        this._refreshRows();
        this._selectSlot(this._profiles.length - 1);
    }

    private _delete(): void {
        if (this._editing || !this._profile) return;
        this._profiles.splice(this._slot, 1);
        saveProfiles(this._profiles);
        this._refreshRows();
        this._selectSlot(this._slot);
    }

    private async _accept(): Promise<void> {
        const profile = this._profile;
        if (!profile || this._editing) {
            const text = this._editing
                ? "Please press 'Enter' to finish editing player name."
                : this._profiles.length === 0
                  ? "Please press 'Add' to create a player name."
                  : "Please select a player name 'SLOT' to continue.";
            await promptOk(this._parent, 'Missing Name!', text);
            return;
        }
        const car = CARS[this._car];
        if (!isCarUnlocked(car, profile.points)) {
            await promptOk(this._parent, 'Bug is locked!', 'Please select one of the available bugs.');
            return;
        }
        this._onAccept({ profile, car });
    }
}
