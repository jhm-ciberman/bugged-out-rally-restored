/** Number of height samples along each side of a Torque terrain block. */
export const TERRAIN_SIZE = 256;

const MATERIAL_SLOTS = 8;
const CELLS = TERRAIN_SIZE * TERRAIN_SIZE;

/**
 * A decoded Torque `.ter` terrain file (version 3 or lower).
 */
export interface TerrainFile {
  /** File format version. */
  readonly version: number;
  /** Heights in meters, indexed `x + y * TERRAIN_SIZE`. */
  readonly heights: Float32Array;
  /** Per-sample flags and base material, indexed like {@link heights}. */
  readonly materialMap: Uint8Array;
  /** Texture names of the materials, one per used slot. */
  readonly materials: readonly TerrainMaterial[];
}

/**
 * One texture layer painted onto the terrain.
 */
export interface TerrainMaterial {
  /** The texture name as written in the file, such as `safarirace/data/terrains/grassland/grass`. */
  readonly textureName: string;
  /** Blend weight per height sample (0-255), indexed like {@link TerrainFile.heights}. */
  readonly alpha: Uint8Array;
}

/**
 * Decodes the bytes of a Torque `.ter` file.
 *
 * @throws Error when the file is truncated or has trailing bytes.
 */
export function parseTerrain(buffer: ArrayBuffer): TerrainFile {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let pos = 0;

  const version = bytes[pos++];

  const heights = new Float32Array(CELLS);
  for (let i = 0; i < CELLS; i++, pos += 2) {
    // Heights are 11.5 fixed point (fixedToFloat in terrData.h).
    heights[i] = view.getUint16(pos, true) / 32;
  }

  const materialMap = bytes.slice(pos, pos + CELLS);
  pos += CELLS;

  const names: string[] = [];
  for (let i = 0; i < MATERIAL_SLOTS; i++) {
    const len = bytes[pos++];
    names.push(String.fromCharCode(...bytes.subarray(pos, pos + len)));
    pos += len;
  }

  const materials: TerrainMaterial[] = [];
  if (version !== 1) {
    for (const name of names) {
      if (!name) continue;
      materials.push({ textureName: name, alpha: bytes.slice(pos, pos + CELLS) });
      pos += CELLS;
    }
  }

  if (version >= 3) {
    for (let i = 0; i < 2; i++) {
      pos += 4 + view.getUint32(pos, true);
    }
  }

  if (pos !== buffer.byteLength) {
    throw new Error(`Terrain file has ${buffer.byteLength - pos} unexpected trailing bytes`);
  }
  return { version, heights, materialMap, materials };
}
