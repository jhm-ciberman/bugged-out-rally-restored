import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Car } from '../src/game/Car';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { TERRAIN_SIZE, type TerrainFile } from '../src/torque/TerrainFile';
import { BOMB, Projectile, ROCKET, SPIT } from '../src/weapons/Projectile';
import { TerrainHeightfield } from '../src/world/TerrainHeightfield';

function flatWorld(): CollisionWorld {
    const file: TerrainFile = {
        version: 3,
        heights: new Float32Array(TERRAIN_SIZE * TERRAIN_SIZE).fill(0),
        materialMap: new Uint8Array(TERRAIN_SIZE * TERRAIN_SIZE),
        materials: [],
    };
    return new CollisionWorld(new TerrainHeightfield(file, -1024, -1024, 8), []);
}

/** The parts of a car a projectile looks at. */
function carAt(x: number, y: number, z: number): Car {
    const position = new THREE.Vector3(x, y, z);
    return {
        respawnTimer: 0,
        vehicle: {
            rigid: { linPosition: position, angPosition: new THREE.Quaternion(), worldCenterOfMass: position },
            data: { bounds: new THREE.Box3(new THREE.Vector3(-2, -3, -1), new THREE.Vector3(2, 3, 1)) },
        },
    } as unknown as Car;
}

function fly(p: Projectile, cars: Car[], ticks: number) {
    const world = flatWorld();
    for (let i = 0; i < ticks; i++) {
        const hit = p.tick(world, cars);
        if (hit) return hit;
        if (p.expired) return null;
    }
    return null;
}

describe('Projectile', () => {
    it('homes a Zinger onto a car inside its cone', () => {
        const target = carAt(40, 100, 10);
        const p = new Projectile(ROCKET, null, new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 150, 0));
        expect(fly(p, [target], 100)?.car).toBe(target);
    });

    it('ignores a car outside the cone', () => {
        const target = carAt(100, 10, 10);
        const p = new Projectile(ROCKET, null, new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 150, 0));
        expect(fly(p, [target], 100)?.car ?? null).toBeNull();
    });

    it('never hits or chases its shooter', () => {
        const shooter = carAt(0, 5, 10);
        const p = new Projectile(ROCKET, shooter, new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 150, 0));
        expect(fly(p, [shooter], 30)?.car ?? null).toBeNull();
    });

    it('parks a Magno bomb with no car near, then goes for a car that comes within 50 m', () => {
        const p = new Projectile(BOMB, null, new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 60, 0));
        fly(p, [], 10);
        expect(p.velocity.length()).toBe(0);
        const passerby = carAt(p.position.x + 30, p.position.y, 10);
        expect(fly(p, [passerby], 100)?.car).toBe(passerby);
    });

    it('lets frog spit reach about 160 m before it expires', () => {
        const p = new Projectile(SPIT, null, new THREE.Vector3(0, 0, 50), new THREE.Vector3(0, 80, 0));
        fly(p, [], 1000);
        expect(p.expired).toBe(true);
        expect(p.position.y).toBeGreaterThan(140);
        expect(p.position.y).toBeLessThan(170);
    });
});
