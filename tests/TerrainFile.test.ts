import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTerrain, TERRAIN_SIZE } from "../src/torque/TerrainFile";

const missions = path.resolve(import.meta.dirname, "../public/assets/data/missions");

function load(n: number) {
  const buf = fs.readFileSync(path.join(missions, `track${n}.ter`));
  return parseTerrain(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

describe("parseTerrain", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("reads every byte of track%i.ter", (n) => {
    const ter = load(n);
    expect(ter.version).toBe(3);
    expect(ter.materials.length).toBeGreaterThan(0);
  });

  it("puts the track1 start line just under the spawn points", () => {
    // Spawn sphere at (133.564, 869.547, 219.996); the block starts at (-1024, -1024), 8 m squares.
    const ter = load(1);
    const x = Math.round((133.564 + 1024) / 8) % TERRAIN_SIZE;
    const y = Math.round((869.547 + 1024) / 8) % TERRAIN_SIZE;
    const h = ter.heights[x + y * TERRAIN_SIZE];
    expect(h).toBeGreaterThan(210);
    expect(h).toBeLessThan(221);
  });
});
