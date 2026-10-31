import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useTorqueFog } from '../render/TorqueFog';
import { assetUrl } from './AssetPaths';
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
        const url = modelUrl(torquePath);
        if (!url) return null;
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
 * Maps a Torque model path to the URL of its converted `.glb`, or `null` for unknown types.
 */
export function modelUrl(torquePath: string): string | null {
    const path = torquePath
        .replace(/\\/g, '/')
        .replace(/^~\/data\//i, '')
        .toLowerCase();
    const ext = path.slice(path.lastIndexOf('.'));
    const stem = path.slice(0, path.lastIndexOf('.'));
    if (ext === '.dif') {
        return assetUrl(`models/interiors/${stem.slice(stem.lastIndexOf('/') + 1)}.glb`);
    }
    if (ext === '.dts') {
        if (stem.startsWith('shapes/car/')) {
            return assetUrl(`models/cars/${stem.slice('shapes/car/'.length)}.glb`);
        }
        const local = stem.startsWith('shapes/') ? stem.slice('shapes/'.length) : stem;
        return assetUrl(`models/props/${local.replace(/\//g, '__')}.glb`);
    }
    return null;
}

function prepareMesh(mesh: THREE.Mesh): void {
    // The converted models carry no normals.
    if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();

    const old = mesh.material as THREE.MeshStandardMaterial;
    const map = old.map;
    if (map) map.colorSpace = THREE.NoColorSpace;
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
