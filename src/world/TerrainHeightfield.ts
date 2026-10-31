import { TERRAIN_SIZE, type TerrainFile } from '../torque/TerrainFile';

const MASK = TERRAIN_SIZE - 1;

/**
 * Height lookups on a Torque terrain block, matching the engine's triangle layout.
 *
 * The block repeats forever in X and Y, like in Torque.
 */
export class TerrainHeightfield {
    /**
     * @param file The decoded terrain.
     * @param originX World X of the block's first sample.
     * @param originY World Y of the block's first sample.
     * @param squareSize Meters between two samples.
     */
    constructor(
        readonly file: TerrainFile,
        readonly originX: number,
        readonly originY: number,
        readonly squareSize: number,
    ) {}

    /** World size of one block side, in meters. */
    get blockSize(): number {
        return TERRAIN_SIZE * this.squareSize;
    }

    /**
     * Returns the height sample at grid coordinates, wrapping around the block.
     */
    sample(x: number, y: number): number {
        return this.file.heights[(x & MASK) + (y & MASK) * TERRAIN_SIZE];
    }

    /**
     * Whether the grid square at `(x, y)` is cut along the (0,0)-(1,1) diagonal.
     *
     * At full detail Torque alternates the diagonal like a checkerboard (`TerrainBlock::buildGridMap`).
     */
    static isSplit45(x: number, y: number): boolean {
        return ((x ^ y) & 1) === 0;
    }

    /**
     * Writes the upward normal of the terrain triangle under a world position into `out`.
     */
    normalAt(worldX: number, worldY: number, out: { x: number; y: number; z: number }): void {
        const xp0 = (worldX - this.originX) / this.squareSize;
        const yp0 = (worldY - this.originY) / this.squareSize;
        const x = Math.floor(xp0);
        const y = Math.floor(yp0);
        const xp = xp0 - x;
        const yp = yp0 - y;
        const bl = this.sample(x, y);
        const br = this.sample(x + 1, y);
        const tl = this.sample(x, y + 1);
        const tr = this.sample(x + 1, y + 1);

        // Slopes along X and Y of the triangle that contains the point.
        let dx: number;
        let dy: number;
        if (TerrainHeightfield.isSplit45(x & MASK, y & MASK)) {
            if (xp > yp) {
                dx = br - bl;
                dy = tr - br;
            } else {
                dx = tr - tl;
                dy = tl - bl;
            }
        } else if (1 - xp > yp) {
            dx = br - bl;
            dy = tl - bl;
        } else {
            dx = tr - tl;
            dy = tr - br;
        }
        const s = this.squareSize;
        const len = Math.hypot(dx, dy, s);
        out.x = -dx / len;
        out.y = -dy / len;
        out.z = s / len;
    }

    /**
     * Returns the terrain height at a world position (`TerrainBlock::getHeight`).
     */
    heightAt(worldX: number, worldY: number): number {
        const xp0 = (worldX - this.originX) / this.squareSize;
        const yp0 = (worldY - this.originY) / this.squareSize;
        const x = Math.floor(xp0);
        const y = Math.floor(yp0);
        const xp = xp0 - x;
        const yp = yp0 - y;

        const bl = this.sample(x, y);
        const br = this.sample(x + 1, y);
        const tl = this.sample(x, y + 1);
        const tr = this.sample(x + 1, y + 1);

        if (TerrainHeightfield.isSplit45(x & MASK, y & MASK)) {
            return xp > yp ? bl + xp * (br - bl) + yp * (tr - br) : bl + xp * (tr - tl) + yp * (tl - bl);
        }
        return 1 - xp > yp ? br + (1 - xp) * (bl - br) + yp * (tl - bl) : br + (1 - xp) * (tl - tr) + yp * (tr - br);
    }
}
