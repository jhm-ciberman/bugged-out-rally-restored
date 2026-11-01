# Bugged Out Rally, Restored

A browser port of **Bugged Out Rally** (Inoculous Games, 2004), a combat racing game where you drive bugs with wheels. The original ran on the Torque Game Engine and has been abandonware for years. This port rebuilds it with three.js and TypeScript, keeping the original assets and rules.

## Play

```bash
npm ci
npm run dev
```

Then open the URL Vite prints. Needs Node 20.19+ or 22.12+.

For a production build, `npm run build` writes a static site to `dist/`. Any static web server can host it.

## What's in it

- **8 tracks**: Croaky Pond, Turtle Creek, Twin Peaks, Boomerang II, Snowbound, Ocean Side, Dunes II and Lunar.
- **8 bugs**, unlocked with race winnings: Beetle, Ladybug, Cockroach, Grasshopper, Hornet, Praying Mantis, Scorpion and BlackWidow.
- **3 events**: Explore (no opponents), Single Event (3 bots) and Race Circuit (5 bots).
- Zinger rockets, Magno bombs, boost pads, hazards (frogs, boulders, water), player profiles and the original menus.
- It is the full version: the demo limits of the original are not ported.

Profiles and settings are saved in the browser.

## Controls

| Key | Action |
|---|---|
| Arrow keys, or W and S plus the mouse | Drive and steer |
| Space | Brake |
| A or left mouse button | Fire a Zinger |
| D or right mouse button | Drop a Magno bomb |
| E | Zoom |
| R | Change the zoom level |
| Tab | First or third person |
| Enter | Put the car back on the track |
| Page Up / Page Down | Scroll the message log |
| Escape | In-race menu |

Keys can be remapped in Options, Controls.

## How it was restored

The goal is to play like the original, not like a remake. Every value was taken from the original files where possible, and the result was checked side by side against the original game.

- **Scripts**: the original game logic is TorqueScript, shipped compiled. The scripts were decompiled with [dso-sharp](https://github.com/Elletra/dso-sharp) and read as the reference for the rules, menus, datablocks and sounds.
- **Assets**: models (DTS) and buildings (DIF) were converted to glTF with small Python tools. Terrain, missions, textures and sounds are used as they are.
- **Engine behaviour**: the C++ engine is stock Torque 1.5.2, so its public source explains most of it. The parts the game changed (bot driving and targeting, race positions, the wrong-way warning) were decoded from the original executable.
- **Checking**: a script runs the original game, places the camera or the car, logs positions and speeds, and takes screenshots. Physics, bot lap times, shadows, the HUD and the menus were compared against it.

Some original bugs that broke a feature by accident were fixed. Ones that are part of how the game plays were kept.

## Development

- `npm run dev` starts the game. A few URL flags help: `?track=N` (1 to 8) goes straight into a race, with `&event=single|circuit|explore` and `&car=Cockroach`. `?fly` loads a track with a free camera, `?mute` starts muted, and `?debug` (or F2) shows a debug panel.
- `npm test` runs the tests. `npm run lint` formats and checks the code.

## Credits

Bugged Out Rally was made by **Inoculous Games**:

- **Akio Cullum**: producer, programmer and art.
- **Thomas Cullum**: soundtrack.

The original game was powered by the Torque Game Engine by GarageGames.

All game assets (models, textures, sounds and music) belong to their original authors. This project only restores the game so it can still be played.

## Rights holders

If you hold the rights to Bugged Out Rally and want this removed, please open an issue and it will be taken down.
