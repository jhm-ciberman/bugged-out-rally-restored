import { Game } from './Game';

const game = new Game(document.body);
void game.run();
// Exposed for debugging from the browser console.
(window as unknown as { game: Game }).game = game;
