import * as THREE from 'three';
import { assetUrl, findAssetByName } from './AssetPaths';

/** Torque image-file-list frame durations are counted at 30 frames per second. */
const IFL_FPS = 30;

interface IflFrame {
    readonly texture: THREE.Texture;
    readonly seconds: number;
}

const animated: { materials: THREE.MeshLambertMaterial[]; frames: IflFrame[]; total: number }[] = [];
const loader = new THREE.TextureLoader();

/**
 * Returns the `.ifl` file behind a DTS material name such as `testarrowifl.jpg`, or `null` when the
 * material is a plain image.
 */
export function iflForMaterial(materialName: string): string | null {
    const m = /^(.*)ifl(\.[a-z]+)?$/i.exec(materialName.replace(/^.*[/]/, ''));
    return m ? findAssetByName(`${m[1]}.ifl`) : null;
}

/**
 * Makes `material` cycle through the frames of an image file list (`.ifl`), the way Torque
 * animates textures. Call {@link updateIflTextures} every frame.
 */
export async function animateWithIfl(material: THREE.MeshLambertMaterial, iflPath: string): Promise<void> {
    const text = await (await fetch(assetUrl(iflPath))).text();
    const dir = iflPath.replace(/[^/]*$/, '');
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== '');
    const frames: IflFrame[] = await Promise.all(
        lines.map(async (line) => {
            const [file, count] = line.split(/\s+/);
            const texture = await loader.loadAsync(assetUrl(dir + file));
            texture.colorSpace = THREE.NoColorSpace;
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            return { texture, seconds: Number(count ?? 1) / IFL_FPS };
        }),
    );
    if (frames.length === 0) return;
    material.map = frames[0].texture;
    material.color.set(0xffffff);
    material.needsUpdate = true;
    animated.push({ materials: [material], frames, total: frames.reduce((t, f) => t + f.seconds, 0) });
}

/**
 * Shows the right frame of every animated texture for `time` seconds since start.
 */
export function updateIflTextures(time: number): void {
    for (const a of animated) {
        let t = time % a.total;
        let frame = a.frames[0];
        for (const f of a.frames) {
            frame = f;
            if (t < f.seconds) break;
            t -= f.seconds;
        }
        for (const m of a.materials) m.map = frame.texture;
    }
}
