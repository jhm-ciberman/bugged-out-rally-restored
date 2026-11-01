import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeWorldTriangles } from '../physics/CollisionWorld';
import { TERRAIN_SIZE } from '../torque/TerrainFile';
import type { TerrainHeightfield } from './TerrainHeightfield';

/** Lumels per side of the terrain lightmap (`TerrainBlock::LightmapSize`). */
export const LIGHTMAP_SIZE = 512;

/** Lumels per terrain square along each axis. */
const LUMELS_PER_SQUARE = LIGHTMAP_SIZE / TERRAIN_SIZE;
/** Height above the terrain that shadow rays start from, so they do not hit the ground they leave. */
const RAY_LIFT = 0.05;

/**
 * Bakes the terrain lightmap like the Torque lighting pass (`sgSceneLightingTerrain.cc`):
 * `clamp(ambient + sunColor * N.L * lit)` per lumel, quantized to 5 bits per channel. `lit` is the part of the
 * lumel the sun reaches: none where the terrain shadows itself, and the part outside the shadows of `casters`.
 *
 * @param lightDirection Direction the sunlight travels, normalized.
 * @param casters Placed objects whose meshes cast shadows on the terrain (interiors and static shapes).
 */
export function bakeTerrainLightmap(
    field: TerrainHeightfield,
    lightDirection: THREE.Vector3,
    sunColor: THREE.Color,
    ambient: THREE.Color,
    casters: readonly THREE.Object3D[] = [],
): THREE.DataTexture {
    const data = new Uint8Array(LIGHTMAP_SIZE * LIGHTMAP_SIZE * 4);
    const lumelMeters = field.squareSize / LUMELS_PER_SQUARE;
    const n = new THREE.Vector3();
    const toSun = lightDirection.clone().negate();
    const horizontal = Math.hypot(toSun.x, toSun.y);
    // Rise of the sun ray per meter walked horizontally toward the sun.
    const slope = horizontal > 1e-6 ? toSun.z / horizontal : Infinity;
    const stepX = horizontal > 1e-6 ? (toSun.x / horizontal) * lumelMeters : 0;
    const stepY = horizontal > 1e-6 ? (toSun.y / horizontal) * lumelMeters : 0;
    const maxSteps = Math.ceil(field.blockSize / lumelMeters);
    const maxHeight = Math.max(...field.file.heights);
    const count = LIGHTMAP_SIZE * LIGHTMAP_SIZE;
    // Sun strength (N.L, 0 where the terrain shadows itself) and terrain height per lumel.
    const sun = new Float32Array(count);
    const heights = new Float32Array(count);

    for (let ly = 0; ly < LIGHTMAP_SIZE; ly++) {
        for (let lx = 0; lx < LIGHTMAP_SIZE; lx++) {
            const wx = field.originX + lx * lumelMeters;
            const wy = field.originY + ly * lumelMeters;
            const h = field.heightAt(wx, wy);
            field.normalAt(wx, wy, n);
            const nDotL = Math.max(0, n.dot(toSun));

            let lit = nDotL > 0;
            if (lit && Number.isFinite(slope)) {
                let x = wx;
                let y = wy;
                for (let s = 1; s <= maxSteps; s++) {
                    x += stepX;
                    y += stepY;
                    const rayZ = h + slope * lumelMeters * s;
                    if (rayZ > maxHeight) break;
                    if (field.heightAt(x, y) > rayZ) {
                        lit = false;
                        break;
                    }
                }
            }

            const i = lx + ly * LIGHTMAP_SIZE;
            sun[i] = lit ? nDotL : 0;
            heights[i] = h;
        }
    }

    const unshadowed = casterLight(field, casters, toSun, sun, heights);
    for (let i = 0; i < count; i++) {
        const k = sun[i] * unshadowed[i];
        data[i * 4] = quantize(ambient.r + sunColor.r * k);
        data[i * 4 + 1] = quantize(ambient.g + sunColor.g * k);
        data[i * 4 + 2] = quantize(ambient.b + sunColor.b * k);
        data[i * 4 + 3] = 255;
    }

    const tex = new THREE.DataTexture(data, LIGHTMAP_SIZE, LIGHTMAP_SIZE, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}

/**
 * Returns, per lumel, the part the casters leave in the sun, 0 to 1. Each sunlit lumel casts one ray from its
 * center; lumels on a shadow edge cast four more, so edges come out partly lit like the engine's clipped
 * lumel areas.
 */
function casterLight(
    field: TerrainHeightfield,
    casters: readonly THREE.Object3D[],
    toSun: THREE.Vector3,
    sun: Float32Array,
    heights: Float32Array,
): Float32Array {
    const out = new Float32Array(sun.length).fill(1);
    const triangles = mergeWorldTriangles(casters);
    if (!triangles || toSun.z <= 0) return out;
    const bvh = new MeshBVH(triangles);
    triangles.computeBoundingBox();
    const top = triangles.boundingBox!.max.z;
    const ray = new THREE.Ray(new THREE.Vector3(), toSun);
    const blocked = (x: number, y: number, z: number): boolean => {
        if (z >= top) return false;
        ray.origin.set(x, y, z + RAY_LIFT);
        return bvh.raycastFirst(ray, THREE.DoubleSide, 0, (top - z) / toSun.z + 1) !== null;
    };

    const lumelMeters = field.blockSize / LIGHTMAP_SIZE;
    const worldX = (lx: number) => field.originX + lx * lumelMeters;
    const worldY = (ly: number) => field.originY + ly * lumelMeters;
    for (let ly = 0; ly < LIGHTMAP_SIZE; ly++) {
        for (let lx = 0; lx < LIGHTMAP_SIZE; lx++) {
            const i = lx + ly * LIGHTMAP_SIZE;
            if (sun[i] > 0 && blocked(worldX(lx), worldY(ly), heights[i])) out[i] = 0;
        }
    }

    const q = lumelMeters / 4;
    const edge = new Float32Array(out);
    for (let ly = 1; ly < LIGHTMAP_SIZE - 1; ly++) {
        for (let lx = 1; lx < LIGHTMAP_SIZE - 1; lx++) {
            const i = lx + ly * LIGHTMAP_SIZE;
            const c = out[i];
            if (
                sun[i] === 0 ||
                (out[i - 1] === c && out[i + 1] === c && out[i - LIGHTMAP_SIZE] === c && out[i + LIGHTMAP_SIZE] === c)
            ) {
                continue;
            }
            let lit = 0;
            for (const [dx, dy] of SUBSAMPLES) {
                if (!blocked(worldX(lx) + dx * q, worldY(ly) + dy * q, heights[i])) lit++;
            }
            edge[i] = lit / SUBSAMPLES.length;
        }
    }
    return edge;
}

/** Offsets of the edge samples inside a lumel, in quarters of a lumel. */
const SUBSAMPLES = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
] as const;

function quantize(value: number): number {
    const v = Math.min(1, Math.max(0, value));
    return Math.round(Math.round(v * 31) * (255 / 31));
}
