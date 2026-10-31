import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CollisionWorld, type Contact } from '../src/physics/CollisionWorld';
import { TERRAIN_SIZE, type TerrainFile } from '../src/torque/TerrainFile';
import { TerrainHeightfield } from '../src/world/TerrainHeightfield';

function worldWith(solid: THREE.Object3D): CollisionWorld {
    const file: TerrainFile = {
        version: 3,
        heights: new Float32Array(TERRAIN_SIZE * TERRAIN_SIZE).fill(0),
        materialMap: new Uint8Array(TERRAIN_SIZE * TERRAIN_SIZE),
        materials: [],
    };
    return new CollisionWorld(new TerrainHeightfield(file, -1024, -1024, 8), [solid]);
}

/** A 4 m square wall in the plane x = 0, spanning y 0..4 and z 10..14. */
function wall(): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([0, 0, 10, 0, 4, 10, 0, 4, 14, 0, 0, 10, 0, 4, 14, 0, 0, 14], 3),
    );
    return new THREE.Mesh(g);
}

describe('CollisionWorld.findContacts', () => {
    it('touches a point just in front of a wall face', () => {
        const world = worldWith(wall());
        const out: Contact[] = [];
        world.findContacts([new THREE.Vector3(0.05, 2, 12)], new THREE.Vector3(2, 2, 12), 0.1, out);
        expect(out).toHaveLength(1);
        expect(out[0].normal.x).toBeCloseTo(1);
    });

    it('does not touch a point beside the free edge of a wall', () => {
        const world = worldWith(wall());
        const out: Contact[] = [];
        // In the wall plane, 1 m past its edge at y = 4.
        world.findContacts([new THREE.Vector3(0.0, 5, 12)], new THREE.Vector3(2, 5, 12), 0.1, out);
        expect(out).toHaveLength(0);
    });

    it('hits a wall from behind with a ray', () => {
        const world = worldWith(wall());
        const hit = world.castRay(new THREE.Vector3(-2, 2, 12), new THREE.Vector3(2, 2, 12));
        expect(hit).not.toBeNull();
        expect(hit!.normal.x).toBeCloseTo(-1);
    });
});
