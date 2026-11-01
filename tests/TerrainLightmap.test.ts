import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TERRAIN_SIZE, type TerrainFile } from '../src/torque/TerrainFile';
import { TerrainHeightfield } from '../src/world/TerrainHeightfield';
import { bakeTerrainLightmap, LIGHTMAP_SIZE } from '../src/world/TerrainLightmap';

function flatField(): TerrainHeightfield {
    const file: TerrainFile = {
        version: 3,
        heights: new Float32Array(TERRAIN_SIZE * TERRAIN_SIZE).fill(0),
        materialMap: new Uint8Array(TERRAIN_SIZE * TERRAIN_SIZE),
        materials: [],
    };
    return new TerrainHeightfield(file, -1024, -1024, 8);
}

/** A flat 40 m roof at z = 10, centered over the world origin. */
function roof(): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
            [-20, -20, 10, 20, -20, 10, 20, 20, 10, -20, -20, 10, 20, 20, 10, -20, 20, 10],
            3,
        ),
    );
    return new THREE.Mesh(g);
}

/** Red channel of the lumel over world point (`x`, `y`). */
function redAt(tex: THREE.DataTexture, field: TerrainHeightfield, x: number, y: number): number {
    const lumel = field.blockSize / LIGHTMAP_SIZE;
    const lx = Math.round((x - field.originX) / lumel);
    const ly = Math.round((y - field.originY) / lumel);
    return (tex.image.data as Uint8Array)[(lx + ly * LIGHTMAP_SIZE) * 4];
}

describe('bakeTerrainLightmap', () => {
    const sun = new THREE.Color(0.6, 0.6, 0.6);
    const ambient = new THREE.Color(0.2, 0.2, 0.2);
    const down = new THREE.Vector3(0.3, 0, -1).normalize();

    it('leaves only the ambient light under a shadow caster', () => {
        const field = flatField();
        const tex = bakeTerrainLightmap(field, down, sun, ambient, [roof()]);
        const shadowed = redAt(tex, field, 0, 0);
        const lit = redAt(tex, field, 200, 200);
        expect(shadowed).toBeLessThan(lit);
        expect(shadowed).toBe(Math.round(Math.round(0.2 * 31) * (255 / 31)));
    });

    it('lights the terrain fully without casters', () => {
        const field = flatField();
        const tex = bakeTerrainLightmap(field, down, sun, ambient);
        expect(redAt(tex, field, 0, 0)).toBe(redAt(tex, field, 200, 200));
    });
});
