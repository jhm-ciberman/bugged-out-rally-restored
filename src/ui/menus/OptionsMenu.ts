import { getSettings, type Settings, updateSettings } from '../../game/Settings';
import { MenuScreen, rel } from './MenuScreen';

/**
 * The options menu (`optionsMenu.gui`): music and sound volume, mouse sensitivity and full screen.
 * The resolution, color depth and texture detail controls of the original have no meaning in a browser
 * and are left out; their labels are part of the background picture.
 */
export class OptionsMenu extends MenuScreen {
    constructor(onBack: () => void, onChange: (settings: Settings) => void) {
        super('optionsselection.jpg');
        const s = getSettings();
        const slider = (rect: ReturnType<typeof rel>, min: number, value: number, set: (v: number) => void) => {
            const input = this.add(document.createElement('input'), rect);
            input.type = 'range';
            input.min = String(min);
            input.max = '1';
            input.step = '0.01';
            input.value = String(value);
            input.style.accentColor = 'rgb(255, 192, 55)';
            input.addEventListener('input', () => {
                set(Number(input.value));
                onChange(getSettings());
            });
        };
        slider(rel(464, 164, 240, 45), 0, s.soundVolume, (v) => updateSettings({ soundVolume: v }));
        slider(rel(464, 100, 236, 50), 0, s.musicVolume, (v) => updateSettings({ musicVolume: v }));
        slider(rel(460, 409, 234, 50), 0.2, s.mouseSensitivity, (v) => updateSettings({ mouseSensitivity: v }));
        const off = { font: 'bold 16px Arial, sans-serif', color: '#fff' };
        this.text('off', off, rel(443, 101, 16, 20));
        this.text('off', off, rel(443, 164, 16, 20));

        const fullscreen = this.add(document.createElement('input'), rel(75, 389, 14, 15));
        fullscreen.type = 'checkbox';
        fullscreen.checked = document.fullscreenElement !== null;
        fullscreen.addEventListener('change', () => {
            if (fullscreen.checked) void document.documentElement.requestFullscreen().catch(() => undefined);
            else if (document.fullscreenElement) void document.exitFullscreen();
        });

        // The original points at `buttons/back`, which never shipped; `back` is the art it meant.
        this.button('back', rel(69, 525, 95, 29), onBack);
    }
}
