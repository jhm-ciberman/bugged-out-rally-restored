import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { textureAnisotropy } from '../game/Settings';
import { useTorqueFog } from '../render/TorqueFog';
import { assetUrl, hasAsset } from './AssetPaths';
import { animateWithIfl, iflForMaterial } from './IflTexture';

/**
 * Loads the converted Torque shapes (`.dts`) and interiors (`.dif`) and hands out copies.
 *
 * Models come back in Torque space (Z up), ready to take a mission transform.
 * Each model file is downloaded once, however many copies are requested.
 */
export class ModelLibrary {
    private readonly _loader = new GLTFLoader();
    private readonly _cache = new Map<string, Promise<THREE.Object3D | null>>();

    /**
     * Returns a new copy of the model for a Torque shape or interior path,
     * such as `~/data/bor/fence5.dif`, or `null` when no converted model exists.
     */
    async instantiate(torquePath: string): Promise<THREE.Object3D | null> {
        const path = modelPath(torquePath);
        return path ? this._instantiate(path) : null;
    }

    /**
     * Returns a new copy of the collision mesh of a Torque shape (its `collision-1` detail),
     * or `null` when the shape has none and so is not solid.
     */
    async instantiateCollision(torquePath: string): Promise<THREE.Object3D | null> {
        const path = modelPath(torquePath);
        if (!path?.startsWith('models/props/')) return null;
        const collision = path.replace('models/props/', 'models/collision/');
        return hasAsset(collision) ? this._instantiate(collision) : null;
    }

    private async _instantiate(path: string): Promise<THREE.Object3D | null> {
        const url = assetUrl(path);
        let pending = this._cache.get(url);
        if (!pending) {
            pending = this._load(url);
            this._cache.set(url, pending);
        }
        const template = await pending;
        return template ? template.clone(true) : null;
    }

    private async _load(url: string): Promise<THREE.Object3D | null> {
        try {
            const gltf = await this._loader.loadAsync(url);
            const root = gltf.scene;
            // Copies made with clone() share these.
            root.animations = gltf.animations;
            // The exporter wraps the model in a Z-up to Y-up node. The game works in Torque space, so undo it.
            root.getObjectByName('ZtoY')?.quaternion.identity();
            root.traverse((obj) => {
                if (obj instanceof THREE.Mesh) prepareMesh(obj);
            });
            root.updateMatrixWorld(true);
            return root;
        } catch (err) {
            console.warn(`Model failed to load: ${url}`, err);
            return null;
        }
    }
}

/**
 * Maps a Torque model path to the path of its converted `.glb` under `public/assets`,
 * or `null` for unknown types.
 */
export function modelPath(torquePath: string): string | null {
    const path = torquePath
        .replace(/\\/g, '/')
        .replace(/^~\/data\//i, '')
        .toLowerCase();
    const ext = path.slice(path.lastIndexOf('.'));
    const stem = path.slice(0, path.lastIndexOf('.'));
    if (ext === '.dif') {
        return `models/interiors/${stem.slice(stem.lastIndexOf('/') + 1)}.glb`;
    }
    if (ext === '.dts') {
        if (stem.startsWith('shapes/car/')) {
            return `models/cars/${stem.slice('shapes/car/'.length)}.glb`;
        }
        const local = stem.startsWith('shapes/') ? stem.slice('shapes/'.length) : stem;
        return `models/props/${local.replace(/\//g, '__')}.glb`;
    }
    return null;
}

function prepareMesh(mesh: THREE.Mesh): void {
    // The converted models carry no normals.
    if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();

    const old = mesh.material as THREE.MeshStandardMaterial;
    const map = old.map;
    if (map) {
        map.colorSpace = THREE.NoColorSpace;
        map.anisotropy = textureAnisotropy();
    }
    // Torque lit shapes with plain diffuse lighting, no specular.
    const material = useTorqueFog(
        new THREE.MeshLambertMaterial({
            name: old.name,
            map,
            color: map ? 0xffffff : old.color,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
        }),
    );
    mesh.material = material;
    old.dispose();
    // Animated textures (image file lists) were left untextured by the converter.
    const ifl = map ? null : iflForMaterial(old.name);
    if (ifl) void animateWithIfl(material, ifl);
}
