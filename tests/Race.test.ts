import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Race } from '../src/game/Race';
import { parseMission, walkMission } from '../src/torque/MissionFile';
import type { WheeledVehicle } from '../src/vehicle/WheeledVehicle';
import type { Track } from '../src/world/Track';

const missions = path.resolve(import.meta.dirname, '../public/assets/data/missions');

function track1(): Track {
    const objects = [...walkMission(parseMission(fs.readFileSync(path.join(missions, 'track1.mis'), 'latin1')))];
    return { objects } as unknown as Track;
}

function carAt(position: THREE.Vector3): WheeledVehicle {
    return {
        rigid: { linPosition: position, angPosition: new THREE.Quaternion(), worldCenterOfMass: position },
    } as unknown as WheeledVehicle;
}

/** Starts a race on track 1 with one racer at `position`, past the countdown. */
function racingAt(position: THREE.Vector3, prints: string[]) {
    const race = new Race(track1(), { onCenterPrint: (_, text) => prints.push(text) });
    const racer = race.addRacer('Player', carAt(position));
    racer.resetting = false;
    for (let t = 0; t < 5.1; t += 0.032) race.tick(0.032);
    expect(race.phase).toBe('racing');
    return { race, racer };
}

/** Drives `position` along `direction` at `speed` m/s until "Wrong Way!" or 10 s; returns the seconds driven. */
function driveUntilWarned(
    race: Race,
    position: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number,
    prints: string[],
): number {
    let seconds = 0;
    while (!prints.includes('Wrong Way!') && seconds < 10) {
        position.addScaledVector(direction, speed * 0.032);
        race.tick(0.032);
        seconds += 0.032;
    }
    return seconds;
}

describe('Race', () => {
    it('warns "Wrong Way!" after about 3 seconds of losing ground on the way to the next checkpoint', () => {
        const prints: string[] = [];
        const markers = new Race(track1()).markers;
        const first = markers.get(1)!;
        const last = markers.get(markers.size)!;
        // Halfway along the leg from the last checkpoint to the first, driving back toward the last one.
        const position = first.clone().lerp(last, 0.5);
        const { race } = racingAt(position, prints);
        const away = last.clone().sub(first).setZ(0).normalize();
        const seconds = driveUntilWarned(race, position, away, 20, prints);
        expect(seconds).toBeGreaterThan(2.9);
        expect(seconds).toBeLessThan(3.5);
    });

    it('does not warn while farther from the next checkpoint than the leg is long', () => {
        // The original's progress per leg stops at zero there, so driving away loses nothing (seen in the game).
        const prints: string[] = [];
        const markers = new Race(track1()).markers;
        const first = markers.get(1)!;
        const last = markers.get(markers.size)!;
        const away = first.clone().sub(last).setZ(0).normalize().negate();
        const position = last.clone().addScaledVector(away, 50);
        const { race } = racingAt(position, prints);
        driveUntilWarned(race, position, away, 20, prints);
        expect(prints).not.toContain('Wrong Way!');
    });
});
