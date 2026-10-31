import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { BOULDER, DynamicShape } from '../src/physics/DynamicShape';
import { TERRAIN_SIZE, type TerrainFile } from '../src/torque/TerrainFile';
import { TerrainHeightfield } from '../src/world/TerrainHeightfield';

/** Ground that rises 0.3 m per meter toward +X around the origin. */
function slope(): CollisionWorld {
    const heights = new Float32Array(TERRAIN_SIZE * TERRAIN_SIZE);
    for (let y = 0; y < TERRAIN_SIZE; y++) {
        for (let x = 0; x < TERRAIN_SIZE; x++) heights[x + y * TERRAIN_SIZE] = 500 + (x - 128) * 8 * 0.3;
    }
    const file: TerrainFile = {
        version: 3,
        heights,
        materialMap: new Uint8Array(TERRAIN_SIZE * TERRAIN_SIZE),
        materials: [],
    };
    return new CollisionWorld(new TerrainHeightfield(file, -1024, -1024, 8), []);
}

describe('DynamicShape', () => {
    it('rolls down a slope and stays on the ground', () => {
        const world = slope();
        const ground = world.terrain.heightAt(0, 0);
        const ball = new DynamicShape(BOULDER, world, new THREE.Vector3(0, 0, ground + 4), new THREE.Vector3());
        for (let i = 0; i < 150; i++) ball.tick(0.032);
        const p = ball.rigid.linPosition;
        expect(p.x).toBeLessThan(-5);
        const under = world.terrain.heightAt(p.x, p.y);
        expect(p.z - under).toBeGreaterThan(1.5);
        expect(p.z - under).toBeLessThan(4);
    });
});
