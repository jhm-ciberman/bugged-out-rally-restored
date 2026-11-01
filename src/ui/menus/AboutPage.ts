import { arialFont } from '../GuiControls';
import { MenuScreen, rel640 } from './MenuScreen';

const ORANGE = 'rgb(255, 162, 0)';
const LINK = 'rgb(255, 215, 0)';

/**
 * The about page (`aboutpage.gui`): credits and the default controls, with the original texts.
 */
export class AboutPage extends MenuScreen {
    constructor(onBack: () => void) {
        super('aboutpage.jpg');
        const html = (rect: ReturnType<typeof rel640>, content: string) => {
            // `<lmargin%:5><rmargin%:95>`: the text runs from 5% to 95% of the control's width.
            const el = this.marginText('', { font: arialFont(16), color: ORANGE }, rect, 5, 95);
            el.innerHTML = content;
        };
        const b = (text: string, size = 16) => `<b style="font-size:${size}px">${text}</b>`;
        const link = (url: string, text: string) =>
            `<a href="https://${url}" target="_blank" rel="noopener" style="color:${LINK}">${b(text)}</a>`;
        html(
            rel640(32, 42, 248, 268),
            `${b('Credits', 20)}<div style="text-align:center">${b('Sound Track', 20)}<br>Thomas Cullum<br><br>` +
                `${b('Producer, Programmer, &amp; Art', 20)}<br>Akio Cullum<br><br><br><br>` +
                `${b('Bugged Out Rally, Version 1.07')}<br>${link('www.inoculousgames.com', 'www.InoculousGames.com')}<br>` +
                `${b('Copyright 2004, All rights reserved.')}<br>${b('Single user license')}<br>${b('for non-commercial use.')}</div>`,
        );
        html(
            rel640(44, 319, 236, 32),
            `${b('This game powered by the Torque Game Engine.')} ${link('www.garagegames.com', 'GarageGames.com')}`,
        );
        const row = (key: string, action: string) =>
            `<div style="display:flex"><span style="width:105px">${key}</span><span>${action}</span></div>`;
        html(
            rel640(348, 44, 246, 291),
            `${b('Default Control', 20)}<br><br>${b('Movement')}` +
                row('Arrow Keys', 'Drive and Steering') +
                row('Mouse', 'Alternate Steering') +
                row('W and S', 'Alternate Drive') +
                row('A, LMB', 'Fire Zinger') +
                row('D, RMB', 'Drop Mine') +
                row('Space', 'Brake') +
                `<br>${b('View Control')}` +
                row('E', 'Zoom') +
                row('TAB', 'First/Third person camera') +
                `<br>${b('Chat')}` +
                row('U', 'Send message'),
        );
        this.button('back', rel640(56, 420, 76, 24), onBack);
    }
}
