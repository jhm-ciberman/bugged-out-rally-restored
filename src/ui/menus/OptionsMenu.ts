import { assetUrl } from '../../assets/AssetPaths';
import { getSettings, type Settings, touchControlsEnabled, updateSettings } from '../../game/Settings';
import { arialFont, guiPx, safariSlider, styleTorqueCheckbox } from '../GuiControls';
import { bindFullscreenCheckbox } from '../PageFullscreen';
import { MenuScreen, rel } from './MenuScreen';

/** `GuiSafariPopUpMenuProfile`: orange fill and white text, drawn like the original menu box. */
const POPUP_STYLE: Partial<CSSStyleDeclaration> = {
    appearance: 'none',
    background: 'rgb(255, 192, 55)',
    color: '#fff',
    // A raised box, as the original draws it: light top-left, dark bottom-right.
    borderStyle: 'solid',
    borderWidth: '1px',
    borderColor: '#fff #000 #000 #fff',
    font: arialFont(20),
    textAlign: 'center',
    textAlignLast: 'center',
    cursor: 'pointer',
};

/**
 * The options menu (`optionsMenu.gui`). The labels are part of the background picture, so each control
 * sits where the original had one: render quality takes the Resolution menu, Unlock Everything takes
 * the Bit Depth menu, and Texture Detail, Full Screen, the volumes and mouse sensitivity keep their place.
 */
export class OptionsMenu extends MenuScreen {
    private readonly _unbindFullscreen: () => void;

    constructor(onBack: () => void, onChange: (settings: Settings) => void, onControls: () => void) {
        super('optionsselection.jpg');
        const s = getSettings();
        const changed = (changes: Partial<Settings>) => {
            updateSettings(changes);
            onChange(getSettings());
        };

        // `GuiSliderCtrl` with 5 ticks, as in optionsMenu.gui.
        const slider = (rect: ReturnType<typeof rel>, min: number, value: number, set: (v: number) => void) => {
            this.add(safariSlider(rect.w, rect.h, [min, 1], 5, value, set), rect);
        };
        slider(rel(464, 164, 240, 45), 0, s.soundVolume, (v) => changed({ soundVolume: v }));
        slider(rel(464, 100, 236, 50), 0, s.musicVolume, (v) => changed({ musicVolume: v }));
        slider(rel(460, 409, 234, 50), 0.2, s.mouseSensitivity, (v) => changed({ mouseSensitivity: v }));
        const off = { font: arialFont(16, true), color: '#fff' };
        this.text('off', off, rel(443, 101, 16, 20));
        this.text('off', off, rel(443, 164, 16, 20));

        const quality = this._popup(
            rel(75, 125, 239, 34),
            [
                ['low', 'Low'],
                ['medium', 'Medium'],
                ['high', 'High'],
                ['native', 'Native'],
            ],
            s.renderQuality,
        );
        quality.addEventListener('change', () =>
            changed({ renderQuality: quality.value as Settings['renderQuality'] }),
        );

        const detail = this._popup(
            rel(75, 319, 244, 40),
            ['High', 'Normal', 'Low', 'V.Low'].map((label, i) => [String(i), label]),
            String(s.textureDetail),
        );
        detail.addEventListener('change', () => changed({ textureDetail: Number(detail.value) }));

        this._coverBitDepthLabel();
        // Styled like the labels painted into the background.
        this.text(
            'Unlock Everything',
            { font: `bold ${guiPx(22)} Verdana, Tahoma, sans-serif`, color: 'rgb(215, 14, 48)' },
            rel(94, 186, 300, 28),
            { textShadow: '2px 2px 1px rgba(60, 0, 0, 0.7)' },
        );
        const { box: unlock } = this._checkbox(rel(75, 192, 14, 15), s.unlockAll);
        unlock.addEventListener('change', () => changed({ unlockAll: unlock.checked }));

        const fullscreen = this._checkbox(rel(75, 389, 14, 15), false);
        this._unbindFullscreen = bindFullscreenCheckbox(fullscreen.box, fullscreen.repaint);

        // The original points at `buttons/back`, which never shipped; `back` is the art it meant.
        this.button('back', rel(69, 525, 95, 29), onBack);
        // The controls menu waits for a key, which a touch screen doesn't have.
        if (!touchControlsEnabled()) this.button('control', rel(325, 525, 94, 29), onControls);
    }

    override dispose(): void {
        this._unbindFullscreen();
        super.dispose();
    }

    private _popup(rect: ReturnType<typeof rel>, options: string[][], value: string): HTMLSelectElement {
        const select = this.add(document.createElement('select'), rect);
        Object.assign(select.style, POPUP_STYLE);
        for (const [key, label] of options) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = label;
            select.append(option);
        }
        select.value = value;
        return select;
    }

    private _checkbox(rect: ReturnType<typeof rel>, checked: boolean): { box: HTMLInputElement; repaint: () => void } {
        const box = this.add(document.createElement('input'), rect);
        box.type = 'checkbox';
        box.checked = checked;
        return { box, repaint: styleTorqueCheckbox(box) };
    }

    /**
     * Paints the empty panel right of the baked "Bit Depth:" label over it.
     */
    private _coverBitDepthLabel(): void {
        const patch = this.add(document.createElement('canvas'), rel(74, 186, 106, 24));
        patch.width = 106;
        patch.height = 24;
        const img = new Image();
        img.onload = () => patch.getContext('2d')?.drawImage(img, 194, 186, 106, 24, 0, 0, 106, 24);
        img.src = assetUrl('client/ui/optionsselection.jpg');
    }
}
