import { App } from './App';
import { Game } from './Game';
import { parseVector } from './torque/TorqueMath';

const ui = document.createElement('div');
Object.assign(ui.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
const game = new Game(document.body);
document.body.append(ui);
const app = new App(game, ui);
// Exposed for debugging from the browser console.
(window as unknown as { game: Game }).game = game;

const params = new URLSearchParams(window.location.search);
const trackParam = Number(params.get('track'));
const track = trackParam >= 1 && trackParam <= 8 ? trackParam : 1;
const vec = (name: string) => {
    const v = params.get(name);
    return v ? parseVector(v.replace(/,/g, ' ')) : undefined;
};

void game.init().then(() => {
    // Development shortcuts: ?fly (free camera, optional ?cam=x,y,z&look=x,y,z) or ?track=N (straight into a race).
    if (params.has('fly') || params.has('cam')) {
        void game.startFly(track, vec('cam'), vec('look'));
    } else if (params.has('track')) {
        const event = params.get('event');
        app.quickRace(
            track,
            params.get('car') ?? 'Cockroach',
            event === 'explore' || event === 'circuit' ? event : 'single',
            Number(params.get('winnings') ?? 0),
        );
    } else {
        app.start();
    }
});
