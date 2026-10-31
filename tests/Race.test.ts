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

describe('Race', () => {
    it('warns "Wrong Way!" after about 3 seconds of driving away from the next checkpoint', () => {
        const prints: string[] = [];
        const race = new Race(track1(), { onCenterPrint: (_, text) => prints.push(text) });
        const position = new THREE.Vector3(0, 0, 200);
        const racer = race.addRacer('Player', carAt(position));
        racer.resetting = false;
        // Get past the countdown.
        for (let t = 0; t < 5.1; t += 0.032) race.tick(0.032);
        expect(race.phase).toBe('racing');
        const target = race.nextCheckpointPosition(racer)!;
        const away = position.clone().sub(target).setZ(0).normalize();
        let seconds = 0;
        while (!prints.includes('Wrong Way!') && seconds < 10) {
            position.addScaledVector(away, 20 * 0.032);
            race.tick(0.032);
            seconds += 0.032;
        }
        expect(seconds).toBeGreaterThan(2.9);
        expect(seconds).toBeLessThan(3.5);
    });
});
