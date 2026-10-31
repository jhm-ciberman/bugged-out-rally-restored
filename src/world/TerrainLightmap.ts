import * as THREE from 'three';
import { TERRAIN_SIZE } from '../torque/TerrainFile';
import type { TerrainHeightfield } from './TerrainHeightfield';

/** Lumels per side of the terrain lightmap (`TerrainBlock::LightmapSize`). */
export const LIGHTMAP_SIZE = 512;

/** Lumels per terrain square along each axis. */
const LUMELS_PER_SQUARE = LIGHTMAP_SIZE / TERRAIN_SIZE;

/**
 * Bakes the terrain lightmap like the Torque lighting pass (`sgSceneLightingTerrain.cc`):
 * `clamp(ambient + sunColor * N.L)` per lumel, ambient only where the terrain shadows itself,
 * quantized to 5 bits per channel.
 *
 * @param lightDirection Direction the sunlight travels, normalized.
 */
export function bakeTerrainLightmap(
    field: TerrainHeightfield,
    lightDirection: THREE.Vector3,
    sunColor: THREE.Color,
    ambient: THREE.Color,
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

            const k = lit ? nDotL : 0;
            const i = (lx + ly * LIGHTMAP_SIZE) * 4;
            data[i] = quantize(ambient.r + sunColor.r * k);
            data[i + 1] = quantize(ambient.g + sunColor.g * k);
            data[i + 2] = quantize(ambient.b + sunColor.b * k);
            data[i + 3] = 255;
        }
    }

    const tex = new THREE.DataTexture(data, LIGHTMAP_SIZE, LIGHTMAP_SIZE, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}

function quantize(value: number): number {
    const v = Math.min(1, Math.max(0, value));
    return Math.round(Math.round(v * 31) * (255 / 31));
}
