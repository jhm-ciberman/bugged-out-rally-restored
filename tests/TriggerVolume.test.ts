import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseMission, walkMission } from '../src/torque/MissionFile';
import { TriggerVolume } from '../src/world/TriggerVolume';

const missions = path.resolve(import.meta.dirname, '../public/assets/data/missions');

describe('TriggerVolume', () => {
    const objects = [...walkMission(parseMission(fs.readFileSync(path.join(missions, 'track1.mis'), 'latin1')))];
    const trigger = (name: string) => new TriggerVolume(objects.find((o) => o.name === name)!);

    it('extends from its corner along +x, -y and +z', () => {
        // checkpoint6: position (123.102, 970.037, 207.979), scale 70 160 30, almost no rotation.
        const t = trigger('checkpoint6');
        expect(t.contains(new THREE.Vector3(150, 900, 220))).toBe(true);
        expect(t.contains(new THREE.Vector3(150, 1000, 220))).toBe(false);
        expect(t.contains(new THREE.Vector3(100, 900, 220))).toBe(false);
    });

    it('holds the track1 start grid, so cars spawn inside the last checkpoint', () => {
        const t = trigger('checkpoint6');
        const drops = objects.filter((o) => o.className === 'SpawnSphere' && o.name === '').slice(0, 8);
        for (const d of drops) {
            const [x, y, z] = (d.fields.get('position') ?? '').split(' ').map(Number);
            expect(t.contains(new THREE.Vector3(x, y, z))).toBe(true);
        }
    });
});
