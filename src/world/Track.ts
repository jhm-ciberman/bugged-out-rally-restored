import * as THREE from 'three';
import { assetUrl, resolveTorqueFile } from '../assets/AssetPaths';
import { updateIflTextures } from '../assets/IflTexture';
import type { ModelLibrary } from '../assets/ModelLibrary';
import { textureAnisotropy } from '../game/Settings';
import { shapeForDatablock } from '../game/ShapeDatablocks';
import type { IUpdatable } from '../IUpdatable';
import { CollisionWorld } from '../physics/CollisionWorld';
import { torqueFogUniforms } from '../render/TorqueFog';
import { type MissionObject, parseMission, walkMission } from '../torque/MissionFile';
import { parseTerrain } from '../torque/TerrainFile';
import { parseColor, parseNumbers, parseRotation, parseVector } from '../torque/TorqueMath';
import { PhysicalZoneVolume } from './PhysicalZoneVolume';
import { ShapeThread } from './ShapeThread';
import { SkyBox } from './SkyBox';
import { SunFlare } from './SunFlare';
import { TerrainHeightfield } from './TerrainHeightfield';
import { bakeTerrainLightmap } from './TerrainLightmap';
import { createTerrainObject } from './TerrainRenderer';
import { depthAlphaMap, type WaterPasses, WaterSurface } from './WaterSurface';

/** Seconds per turn of a spinning item (`sRotationSpeed` in item.cc). */
const ITEM_SPIN_SECONDS = 3;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * A loaded race track: the mission objects, the terrain and the scene built from them.
 */
export class Track implements IUpdatable {
    private _time = 0;

    private constructor(
        /** The track number, 1 to 8. */
        readonly number: number,
        /** Every object in the mission file, depth first. */
        readonly objects: readonly MissionObject[],
        readonly terrain: TerrainHeightfield,
        /** Everything drawn for the track, in Torque space. */
        readonly root: THREE.Group,
        /** The solid surfaces vehicles collide with. */
        readonly collision: CollisionWorld,
        /** The sky's visible distance; nothing is drawn beyond it. */
        readonly visibleDistance: number,
        private readonly _sky: SkyBox | null,
        private readonly _water: WaterSurface | null,
        private readonly _spinners: readonly THREE.Object3D[],
        /** Pickups placed in the mission (`Item` objects), with their models. */
        readonly items: readonly THREE.Object3D[],
        private readonly _threads: ReadonlyMap<MissionObject, ShapeThread>,
        private readonly _flares: readonly SunFlare[],
        private readonly _camera: THREE.Camera,
    ) {}

    /**
     * Downloads and builds track `number` (1 to 8), with the sky centered on `camera`.
     */
    static async load(number: number, models: ModelLibrary, camera: THREE.Camera): Promise<Track> {
        const misText = await (await fetch(assetUrl(`data/missions/track${number}.mis`))).text();
        const objects = [...walkMission(parseMission(misText))];
        const root = new THREE.Group();
        root.name = `track${number}`;

        // Sun: the engine rebuilds the direction from azimuth and elevation (sun.cc).
        const sun = objects.find((o) => o.className === 'Sun');
        const azimuth = THREE.MathUtils.degToRad(Number(sun?.fields.get('azimuth') ?? 0));
        const elevation = THREE.MathUtils.degToRad(Number(sun?.fields.get('elevation') ?? 35));
        const toSun = new THREE.Vector3(
            Math.sin(azimuth) * Math.cos(elevation),
            Math.cos(azimuth) * Math.cos(elevation),
            Math.sin(elevation),
        );
        const sunColor = parseColor(sun?.fields.get('color') ?? '0.7 0.7 0.7');
        const ambientColor = parseColor(sun?.fields.get('ambient') ?? '0.3 0.3 0.3');

        const terrainObj = objects.find((o) => o.className === 'TerrainBlock');
        if (!terrainObj) throw new Error(`track${number}.mis has no TerrainBlock`);
        const terrain = await loadTerrain(terrainObj);
        const [textures, lightmap] = await Promise.all([
            Promise.all(terrain.file.materials.map((m) => loadTexture(m.textureName))),
            Promise.resolve().then(() => bakeTerrainLightmap(terrain, toSun.clone().negate(), sunColor, ambientColor)),
        ]);
        root.add(createTerrainObject(terrain, { textures, textureMeters: 64, lightmap }));

        // Shapes and interiors: ambient plus a sun dimmed by the ambient brightness (sgLightingModel.cc).
        const ambientLevel = (ambientColor.r + ambientColor.g + ambientColor.b) / 3;
        const diffuse = sunColor.clone().multiplyScalar(THREE.MathUtils.clamp(1 - ambientLevel, 0, 1));
        const sunLight = new THREE.DirectionalLight(diffuse, Math.PI);
        sunLight.position.copy(toSun).multiplyScalar(1000);
        root.add(sunLight, sunLight.target);
        root.add(new THREE.AmbientLight(ambientColor, Math.PI));

        const skyObj = objects.find((o) => o.className === 'Sky');
        const visibleDistance = Number(skyObj?.fields.get('visibledistance') ?? 500);
        applyFog(skyObj);
        const sky = skyObj ? await loadSky(skyObj, visibleDistance, camera) : null;
        if (sky) root.add(sky.object);

        const waterObj = objects.find((o) => o.className === 'WaterBlock');
        const water = waterObj ? await loadWater(waterObj, terrain, toSun) : null;
        if (water) root.add(water.object);

        const placed = await Promise.all(objects.map((o) => placeObject(o, models)));
        const solids: THREE.Object3D[] = [];
        const spinners: THREE.Object3D[] = [];
        const items: THREE.Object3D[] = [];
        const threads = new Map<MissionObject, ShapeThread>();
        for (const [i, model] of placed.entries()) {
            if (!model) continue;
            root.add(model);
            const obj = objects[i];
            if (model.animations.length > 0) {
                const thread = new ShapeThread(model);
                // Every datablock whose shape has an `ambient` sequence starts it in onAdd.
                thread.play('ambient', true);
                threads.set(obj, thread);
            }
            if (obj.className === 'InteriorInstance') solids.push(model);
            if (obj.className === 'Item') items.push(model);
            if (obj.className === 'Item' && obj.fields.get('rotate') === '1') spinners.push(model);
        }
        // Static shapes collide through their collision mesh only (interiors use their visible surfaces).
        const shapeSolids = await Promise.all(objects.map((o) => placeCollision(o, models)));
        for (const solid of shapeSolids) if (solid) solids.push(solid);
        const collision = new CollisionWorld(terrain, solids);
        // The exe scales vehicle gravity by MissionArea.gravityMod, clamped to 0..1 (Lunar uses 0.6).
        const area = objects.find((o) => o.className === 'MissionArea');
        collision.gravityMod = THREE.MathUtils.clamp(Number(area?.fields.get('gravitymod') ?? 1), 0, 1);
        for (const o of objects) {
            if (o.className === 'PhysicalZone') collision.zones.push(new PhysicalZoneVolume(o));
        }
        if (waterObj) {
            const pos = parseVector(waterObj.fields.get('position'));
            const scale = parseVector(waterObj.fields.get('scale'), 1);
            collision.water = {
                min: new THREE.Vector2(pos.x, pos.y),
                max: new THREE.Vector2(pos.x + scale.x, pos.y + scale.y),
                bottomZ: pos.z,
                surfaceZ: pos.z + scale.z,
                viscosity: Number(waterObj.fields.get('viscosity') ?? 15),
                density: Number(waterObj.fields.get('density') ?? 1),
            };
        }

        // Drawn just inside the visible distance, like the engine (`AnimateSun`).
        const flares = objects
            .filter((o) => o.className === 'fxSunLight')
            .map((o) => new SunFlare(o, toSun, visibleDistance * 0.999, collision));
        for (const flare of flares) root.add(flare.object);

        return new Track(
            number,
            objects,
            terrain,
            root,
            collision,
            visibleDistance,
            sky,
            water,
            spinners,
            items,
            threads,
            flares,
            camera,
        );
    }

    /**
     * Returns the named mission object, or `undefined`.
     */
    find(name: string): MissionObject | undefined {
        const key = name.toLowerCase();
        return this.objects.find((o) => o.name.toLowerCase() === key);
    }

    update(deltaSeconds: number): void {
        this._time += deltaSeconds;
        updateIflTextures(this._time);
        this._sky?.update();
        this._water?.update(deltaSeconds);
        // Item::renderImage replaces the rotation with a spin about the shape origin, clockwise from above.
        // Shapes like the cherry sit off their origin, so they swing around a little, as in the original.
        const angle = -(this._time / ITEM_SPIN_SECONDS) * Math.PI * 2;
        for (const s of this._spinners) s.quaternion.setFromAxisAngle(Z_AXIS, angle);
        for (const thread of this._threads.values()) thread.update(deltaSeconds);
        for (const flare of this._flares) flare.update(deltaSeconds, this._camera);
    }

    /**
     * Returns the animation thread of a mission object's shape, or `undefined` when its shape has no sequences.
     */
    thread(obj: MissionObject): ShapeThread | undefined {
        return this._threads.get(obj);
    }
}

async function loadTerrain(obj: MissionObject): Promise<TerrainHeightfield> {
    const file = (obj.fields.get('terrainfile') ?? '').replace(/^\.\//, '');
    const buffer = await (await fetch(assetUrl(`data/missions/${file}`))).arrayBuffer();
    const squareSize = Number(obj.fields.get('squaresize') ?? 8);
    // The engine ignores the mission position and centers the block on the origin (terrData.cc).
    const origin = -squareSize * 128;
    return new TerrainHeightfield(parseTerrain(buffer), origin, origin, squareSize);
}

function applyFog(sky: MissionObject | undefined): void {
    const visible = Number(sky?.fields.get('visibledistance') ?? 500);
    const fogDistance = Number(sky?.fields.get('fogdistance') ?? 400);
    torqueFogUniforms.torqueFogColor.value.copy(parseColor(sky?.fields.get('fogcolor') ?? '0.8 0.8 0.8'));
    torqueFogUniforms.torqueFogRange.value.set(fogDistance, visible);
    const [volVisible, volMin, volMax] = parseNumbers(sky?.fields.get('fogvolume1'), 3);
    torqueFogUniforms.torqueFogVolume.value.set(Math.max(volVisible, 0), volMin, volMax);
}

async function loadSky(obj: MissionObject, visibleDistance: number, camera: THREE.Camera): Promise<SkyBox | null> {
    const dmlPath = obj.fields.get('materiallist');
    const url = dmlPath ? resolveTorqueFile(dmlPath) : null;
    if (!url) return null;
    const names = (await (await fetch(url)).text()).split(/\r?\n/).filter((l) => l.trim() !== '');
    const dir = (dmlPath ?? '').replace(/[^/]*$/, '');
    const faces = await Promise.all(names.slice(0, 5).map((n) => loadTexture(dir + n.trim())));
    return new SkyBox(faces, visibleDistance, camera);
}

async function loadWater(obj: MissionObject, terrain: TerrainHeightfield, toSun: THREE.Vector3): Promise<WaterSurface> {
    const pos = parseVector(obj.fields.get('position'));
    const scale = parseVector(obj.fields.get('scale'), 1);
    const min = new THREE.Vector2(pos.x, pos.y);
    const size = new THREE.Vector2(scale.x, scale.y);
    const surfaceZ = pos.z + scale.z;
    const field = (name: string, fallback: number) => Number(obj.fields.get(name) ?? fallback);
    // Defaults from the WaterBlock constructor.
    const fade = {
        shoreDepth: field('shoredepth', 20),
        minAlpha: field('minalpha', 0.03),
        maxAlpha: field('maxalpha', 1),
        depthGradient: field('depthgradient', 1),
    };
    const groundAt = (x: number, y: number) => terrain.heightAt(x, y);
    const useDepthMask = obj.fields.get('usedepthmask') === '1';
    const depthMap = useDepthMask ? depthAlphaMap(min, size, surfaceZ, groundAt, fade) : null;
    const texture = (name: string) => loadTexture(obj.fields.get(name) ?? '');
    const passes: WaterPasses | null = useDepthMask
        ? {
              shoreMap: depthAlphaMap(min, size, surfaceZ, groundAt, fade, true),
              shoreTexture: await texture('shoretexture'),
              shoreTessellation: field('tessshore', 60),
              specularMask: await texture('specularmasktex'),
              specularColor: parseColor(obj.fields.get('specularcolor') ?? '1 1 1 1'),
              specularPower: field('specularpower', 6),
              toSun,
              envMap: await texture('envmapovertexture'),
              envMapIntensity: field('envmapintensity', 0.4),
          }
        : null;
    return new WaterSurface({
        min,
        size,
        surfaceZ,
        depthMap,
        passes,
        // Defaults from the WaterBlock constructor.
        tessellation: field('tesssurface', 50),
        flowAngle: field('flowangle', 0),
        flowRate: field('flowrate', 0),
        distortMagnitude: field('distortmag', 0.05),
        distortGridScale: field('distortgridscale', 0.1),
        distortTime: field('distorttime', 0.5),
        texture: await loadTexture(obj.fields.get('surfacetexture') ?? ''),
        opacity: Number(obj.fields.get('surfaceopacity') ?? 0.5),
        waveMagnitude: Number(obj.fields.get('wavemagnitude') ?? 1),
        parallax: Number(obj.fields.get('surfaceparallax') ?? 0.5),
    });
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
    tex.anisotropy = textureAnisotropy();
    return tex;
}

/**
 * Returns the shape or interior file a mission object draws, or `undefined` for objects without one.
 */
function shapeOf(obj: MissionObject): string | undefined {
    switch (obj.className) {
        case 'InteriorInstance':
            return obj.fields.get('interiorfile');
        case 'TSStatic':
            return obj.fields.get('shapename');
        case 'StaticShape':
        case 'Item':
            return shapeForDatablock(obj.fields.get('datablock') ?? '');
        default:
            return undefined;
    }
}

function applyMissionTransform(model: THREE.Object3D, obj: MissionObject): void {
    model.position.copy(parseVector(obj.fields.get('position')));
    model.quaternion.copy(parseRotation(obj.fields.get('rotation')));
    model.scale.copy(parseVector(obj.fields.get('scale'), 1));
}

async function placeObject(obj: MissionObject, models: ModelLibrary): Promise<THREE.Object3D | null> {
    if (!['InteriorInstance', 'TSStatic', 'StaticShape', 'Item'].includes(obj.className)) return null;
    const shape = shapeOf(obj);
    if (!shape) {
        console.warn(`No shape for ${obj.className} ${obj.name} (${obj.fields.get('datablock')})`);
        return null;
    }
    const model = await models.instantiate(shape);
    if (!model) return null;
    model.name = obj.name || obj.className;
    applyMissionTransform(model, obj);
    model.userData.mission = obj;
    return model;
}

/**
 * Returns the placed collision mesh of a static shape, or `null` when it is not solid.
 */
async function placeCollision(obj: MissionObject, models: ModelLibrary): Promise<THREE.Object3D | null> {
    if (obj.className !== 'TSStatic' && obj.className !== 'StaticShape') return null;
    const shape = shapeOf(obj);
    const model = shape ? await models.instantiateCollision(shape) : null;
    if (model) applyMissionTransform(model, obj);
    return model;
}
