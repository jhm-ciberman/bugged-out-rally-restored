import * as THREE from "three";
import { assetUrl, resolveTorqueFile } from "../assets/AssetPaths";
import type { ModelLibrary } from "../assets/ModelLibrary";
import { shapeForDatablock } from "../game/ShapeDatablocks";
import { parseMission, walkMission, type MissionObject } from "../torque/MissionFile";
import { parseTerrain } from "../torque/TerrainFile";
import { parseColor, parseNumbers, parseRotation, parseVector } from "../torque/TorqueMath";
import { createTerrainObject } from "./TerrainRenderer";
import { TerrainHeightfield } from "./TerrainHeightfield";

/**
 * A loaded race track: the mission objects, the terrain and the scene built from them.
 */
export class Track {
  private constructor(
    /** The track number, 1 to 8. */
    readonly number: number,
    /** Every object in the mission file, depth first. */
    readonly objects: readonly MissionObject[],
    readonly terrain: TerrainHeightfield,
    /** Everything drawn for the track, in Torque space. */
    readonly root: THREE.Group,
    /** Direction the sunlight travels, normalized. */
    readonly sunDirection: THREE.Vector3,
  ) {}

  /**
   * Downloads and builds track `number` (1 to 8).
   */
  static async load(number: number, models: ModelLibrary): Promise<Track> {
    const misText = await (await fetch(assetUrl(`data/missions/track${number}.mis`))).text();
    const objects = [...walkMission(parseMission(misText))];
    const root = new THREE.Group();
    root.name = `track${number}`;

    const sun = objects.find((o) => o.className === "Sun");
    const sunDirection = parseVector(sun?.fields.get("direction")).normalize();
    const sunColor = parseColor(sun?.fields.get("color"));
    const ambientColor = parseColor(sun?.fields.get("ambient"));

    const terrainObj = objects.find((o) => o.className === "TerrainBlock");
    if (!terrainObj) throw new Error(`track${number}.mis has no TerrainBlock`);
    const terrain = await loadTerrain(terrainObj);
    const textures = await Promise.all(terrain.file.materials.map((m) => loadTexture(m.textureName)));
    root.add(
      createTerrainObject(terrain, {
        textures,
        textureMeters: 64,
        sunDirection,
        sunColor,
        ambientColor,
      }),
    );

    const sunLight = new THREE.DirectionalLight(sunColor, Math.PI);
    sunLight.position.copy(sunDirection).multiplyScalar(-1000);
    root.add(sunLight, sunLight.target);
    root.add(new THREE.AmbientLight(ambientColor, Math.PI));

    await Promise.all(objects.map((o) => placeObject(o, models, root)));
    return new Track(number, objects, terrain, root, sunDirection);
  }

  /**
   * Returns the named mission object, or `undefined`.
   */
  find(name: string): MissionObject | undefined {
    const key = name.toLowerCase();
    return this.objects.find((o) => o.name.toLowerCase() === key);
  }
}

async function loadTerrain(obj: MissionObject): Promise<TerrainHeightfield> {
  const file = (obj.fields.get("terrainfile") ?? "").replace(/^\.\//, "");
  const buffer = await (await fetch(assetUrl(`data/missions/${file}`))).arrayBuffer();
  const [ox, oy] = parseNumbers(obj.fields.get("position"), 2);
  const squareSize = Number(obj.fields.get("squaresize") ?? 8);
  return new TerrainHeightfield(parseTerrain(buffer), ox, oy, squareSize);
}

const textureLoader = new THREE.TextureLoader();

/**
 * Loads a texture referenced by a Torque path, or a magenta pixel when it is missing.
 */
export async function loadTexture(torquePath: string): Promise<THREE.Texture> {
  const url = resolveTorqueFile(torquePath);
  if (!url) {
    console.warn(`Missing texture: ${torquePath}`);
    const tex = new THREE.DataTexture(new Uint8Array([255, 0, 255, 255]), 1, 1);
    tex.needsUpdate = true;
    return tex;
  }
  const tex = await textureLoader.loadAsync(url);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

async function placeObject(obj: MissionObject, models: ModelLibrary, root: THREE.Group): Promise<void> {
  let shape: string | undefined;
  switch (obj.className) {
    case "InteriorInstance":
      shape = obj.fields.get("interiorfile");
      break;
    case "TSStatic":
      shape = obj.fields.get("shapename");
      break;
    case "StaticShape":
    case "Item":
      shape = shapeForDatablock(obj.fields.get("datablock") ?? "");
      break;
    default:
      return;
  }
  if (!shape) {
    console.warn(`No shape for ${obj.className} ${obj.name} (${obj.fields.get("datablock")})`);
    return;
  }
  const model = await models.instantiate(shape);
  if (!model) return;
  model.name = obj.name || obj.className;
  model.position.copy(parseVector(obj.fields.get("position")));
  model.quaternion.copy(parseRotation(obj.fields.get("rotation")));
  model.scale.copy(parseVector(obj.fields.get("scale"), 1));
  model.userData.mission = obj;
  root.add(model);
}
