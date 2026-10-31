import { Game } from './Game';

const game = new Game(document.body);
const track = Number(new URLSearchParams(window.location.search).get('track') ?? 1);
void game.run(track >= 1 && track <= 8 ? track : 1);
// Exposed for debugging from the browser console.
(window as unknown as { game: Game }).game = game;
