import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Car } from '../game/Car';
import { mergeWorldTriangles } from '../physics/CollisionWorld';
import { TerrainHeightfield } from '../world/TerrainHeightfield';
import type { Track } from '../world/Track';
import { torqueFogAmountAt } from './TorqueFog';

/** Size of a shadow image, in pixels (the 128 row of `Shadow::smShadowDetail`). */
const IMAGE_SIZE = 128;
/** Darkest a shadow gets, at the start of its volume (`SG_DYNAMIC_SHADOW_INTENSITY`). */
const INTENSITY = 0.5;
/**
 * The light's fade on the sun shadow. Measured on the original's screenshots, where the shadow comes out at half
 * of {@link INTENSITY}; `sgObjectShadows::sgRender` halves the fade when a second sun-type light is in use.
 */
const SUN_FADE = 0.5;
/** The volume reaches this many shape radii along the light (`sgObjectShadows::sgRender`). */
const LENGTH_RADII = 10;
/** Shortest volume, in meters (`Shadow::setLightDir`). */
const MIN_LENGTH = 1;
/** Most receiving triangles per car. */
const MAX_TRIANGLES = 8192;
/**
 * Camera distances at which the shadow bends toward straight down and shortens (`Shadow::smDistanceSkew`):
 * distance in meters, direction skew and length skew, interpolated between rows.
 */
const DISTANCE_SKEW = [
    [0, 0, 0],
    [100, 0, 0],
    [500, 1, 0.5],
    [1000, 1, 0.7],
] as const;

// Every face, whatever its texture: the engine rasterizes the shape's polygons into a 1-bit image.
const SILHOUETTE = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, side: THREE.DoubleSide });

const VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
    vWorld = position;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

// Torque blurs the silhouette once with a 3x3 kernel: center 3, edges 2, corners 1, over 15.
const FRAGMENT = /* glsl */ `
uniform sampler2D image;
uniform float texel;
uniform vec3 origin;
uniform vec3 right;
uniform vec3 up;
uniform vec3 lightDir;
uniform float radius;
uniform float len;
uniform float strength;
varying vec3 vWorld;
float tap(vec2 uv, float dx, float dy) {
    return texture2D(image, uv + vec2(dx, dy) * texel).r;
}
void main() {
    vec3 local = vWorld - origin;
    vec2 uv = 0.5 + 0.5 * vec2(dot(local, right), dot(local, up)) / radius;
    float depth = dot(local, lightDir);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || depth < 0.0 || depth > len) discard;
    float shape = (3.0 * tap(uv, 0.0, 0.0)
        + 2.0 * (tap(uv, 1.0, 0.0) + tap(uv, -1.0, 0.0) + tap(uv, 0.0, 1.0) + tap(uv, 0.0, -1.0))
        + tap(uv, 1.0, 1.0) + tap(uv, -1.0, 1.0) + tap(uv, 1.0, -1.0) + tap(uv, -1.0, -1.0)) / 15.0;
    gl_FragColor = vec4(vec3(shape * strength * (1.0 - depth / len)), 1.0);
}
`;

const _box = new THREE.Box3();
const _center = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _corner = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/**
 * One car's shadow: its silhouette seen from the sun, and the ground under it that receives the image.
 */
class CarShadow {
    readonly target = new THREE.WebGLRenderTarget(IMAGE_SIZE, IMAGE_SIZE);
    readonly camera = new THREE.OrthographicCamera();
    readonly geometry = new THREE.BufferGeometry();
    readonly material: THREE.ShaderMaterial;
    readonly mesh: THREE.Mesh;
    private readonly _positions = new Float32Array(MAX_TRIANGLES * 9);

    constructor(readonly car: Car) {
        this.geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(this._positions, 3).setUsage(THREE.DynamicDrawUsage),
        );
        this.material = new THREE.ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            uniforms: {
                image: { value: this.target.texture },
                texel: { value: 1 / IMAGE_SIZE },
                origin: { value: new THREE.Vector3() },
                right: { value: new THREE.Vector3() },
                up: { value: new THREE.Vector3() },
                lightDir: { value: new THREE.Vector3() },
                radius: { value: 1 },
                len: { value: 1 },
                strength: { value: 0 },
            },
            // The shadow darkens what is already drawn: dst * (1 - src).
            blending: THREE.CustomBlending,
            blendSrc: THREE.ZeroFactor,
            blendDst: THREE.OneMinusSrcColorFactor,
            // The frame's alpha stays as it is, or the page would show through the shadow.
            blendSrcAlpha: THREE.ZeroFactor,
            blendDstAlpha: THREE.OneFactor,
            depthWrite: false,
            // Interiors are drawn double sided, so their faces receive the shadow from either side.
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
        });
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.frustumCulled = false;
        // After the ground it lands on.
        this.mesh.renderOrder = 1;
    }

    /**
     * Fills the receiving triangles from `write`, which returns how many it wrote.
     */
    setTriangles(write: (out: Float32Array, max: number) => number): void {
        const count = write(this._positions, MAX_TRIANGLES);
        this.geometry.setDrawRange(0, count * 3);
        this.geometry.getAttribute('position').needsUpdate = true;
    }

    dispose(): void {
        this.target.dispose();
        this.geometry.dispose();
        this.material.dispose();
    }
}

/**
 * The soft shadows the cars cast on the terrain and the interiors (`sgObjectShadows`, `Shadow` in shadow.cc):
 * each car's silhouette, seen from the sun and blurred, is projected along the sunlight onto the surfaces below
 * it, fading out with depth. Add {@link object} to the scene and call {@link update} before each frame.
 */
export class CarShadows {
    readonly object = new THREE.Group();
    private readonly _shadows: CarShadow[];
    private readonly _interiors: MeshBVH | null;
    private readonly _terrain: TerrainHeightfield;
    private readonly _sunDir: THREE.Vector3;
    /** The car's own materials while its silhouette is drawn. */
    private readonly _swapped = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

    constructor(track: Track, cars: readonly Car[]) {
        this._terrain = track.terrain;
        this._sunDir = track.toSun.clone().negate();
        const triangles = mergeWorldTriangles(track.interiors);
        this._interiors = triangles ? new MeshBVH(triangles) : null;
        this._shadows = cars.map((car) => new CarShadow(car));
        for (const s of this._shadows) this.object.add(s.mesh);
        this.object.name = 'CarShadows';
    }

    /**
     * Redraws each car's silhouette and gathers the surfaces under it. Call after the cars move, before rendering
     * the frame from `camera`.
     */
    update(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
        const previousTarget = renderer.getRenderTarget();
        const previousClear = renderer.getClearColor(new THREE.Color());
        const previousAlpha = renderer.getClearAlpha();
        renderer.setClearColor(0x000000, 1);
        for (const shadow of this._shadows) this._updateShadow(shadow, renderer, camera);
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(previousClear, previousAlpha);
    }

    dispose(): void {
        for (const s of this._shadows) s.dispose();
        this._interiors?.geometry.dispose();
    }

    private _updateShadow(shadow: CarShadow, renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
        const car = shadow.car;
        const view = car.view.object;
        shadow.mesh.visible = view.visible;
        if (!view.visible) return;

        const u = shadow.material.uniforms;
        car.vehicle.data.bounds.getBoundingSphere(_sphere);
        const radius = _sphere.radius;
        // The volume starts a meter back toward the sun from the middle of the car's box.
        _center.copy(_sphere.center).applyQuaternion(car.renderRotation).add(car.renderPosition);
        const lightDir = u.lightDir.value.copy(this._sunDir);
        const origin = u.origin.value.copy(_center).sub(lightDir);

        const distance = camera.position.distanceTo(origin);
        const [dirSkew, lenSkew] = distanceSkew(distance);
        const dirMult = 1 - dirSkew;
        if (dirMult < 0.99) {
            lightDir.z = lightDir.z * dirMult - (1 - dirMult);
            lightDir.normalize();
        }
        const len = Math.max(MIN_LENGTH, LENGTH_RADII * radius * (1 - lenSkew));
        u.radius.value = radius;
        u.len.value = len;
        u.strength.value = INTENSITY * SUN_FADE * (1 - torqueFogAmountAt(camera.position, origin));

        const right = u.right.value;
        const up = u.up.value;
        // `right` and `up` match the silhouette camera's image axes.
        right.set(0, 0, 1).cross(lightDir);
        if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
        up.crossVectors(lightDir, right).normalize();
        right.crossVectors(lightDir, up).normalize();

        this._drawSilhouette(shadow, renderer, origin, lightDir, up, radius);
        this._gatherReceivers(shadow, origin, lightDir, right, up, radius, len);
    }

    private _drawSilhouette(
        shadow: CarShadow,
        renderer: THREE.WebGLRenderer,
        origin: THREE.Vector3,
        lightDir: THREE.Vector3,
        up: THREE.Vector3,
        radius: number,
    ): void {
        // Looking down the light, with the image's x along `right` and y along `up`.
        const cam = shadow.camera;
        cam.left = -radius;
        cam.right = radius;
        cam.top = radius;
        cam.bottom = -radius;
        cam.near = -radius - 2;
        cam.far = radius + 2;
        cam.position.copy(origin);
        cam.up.copy(up);
        cam.lookAt(_a.copy(origin).add(lightDir));
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();

        const view = shadow.car.view.object;
        const materials = this._swapped;
        view.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
                materials.set(obj, obj.material);
                obj.material = SILHOUETTE;
            }
        });
        try {
            renderer.setRenderTarget(shadow.target);
            renderer.clear();
            renderer.render(view, cam);
        } finally {
            for (const [mesh, material] of materials) mesh.material = material;
            materials.clear();
        }
    }

    private _gatherReceivers(
        shadow: CarShadow,
        origin: THREE.Vector3,
        lightDir: THREE.Vector3,
        right: THREE.Vector3,
        up: THREE.Vector3,
        radius: number,
        len: number,
    ): void {
        // The world box around the volume: the image square swept along the light.
        _box.makeEmpty();
        for (const sx of [-1, 1]) {
            for (const sy of [-1, 1]) {
                for (const d of [0, len]) {
                    _corner
                        .copy(origin)
                        .addScaledVector(right, sx * radius)
                        .addScaledVector(up, sy * radius)
                        .addScaledVector(lightDir, d);
                    _box.expandByPoint(_corner);
                }
            }
        }
        shadow.setTriangles((out, max) => {
            let count = this._terrainTriangles(_box, out, max);
            if (this._interiors && count < max) count = this._interiorTriangles(_box, out, count, max);
            return count;
        });
    }

    private _terrainTriangles(box: THREE.Box3, out: Float32Array, max: number): number {
        const t = this._terrain;
        const s = t.squareSize;
        const x0 = Math.floor((box.min.x - t.originX) / s);
        const x1 = Math.floor((box.max.x - t.originX) / s);
        const y0 = Math.floor((box.min.y - t.originY) / s);
        const y1 = Math.floor((box.max.y - t.originY) / s);
        let count = 0;
        const put = (gx: number, gy: number) => [t.originX + gx * s, t.originY + gy * s, t.sample(gx, gy)] as const;
        const tri = (p: readonly number[], q: readonly number[], r: readonly number[]) => {
            if (count >= max) return;
            out.set(p, count * 9);
            out.set(q, count * 9 + 3);
            out.set(r, count * 9 + 6);
            count++;
        };
        for (let gy = y0; gy <= y1; gy++) {
            for (let gx = x0; gx <= x1; gx++) {
                const bl = put(gx, gy);
                const br = put(gx + 1, gy);
                const tl = put(gx, gy + 1);
                const tr = put(gx + 1, gy + 1);
                // Same diagonal as the terrain, so the shadow lies exactly on it.
                if (TerrainHeightfield.isSplit45(gx & 255, gy & 255)) {
                    tri(bl, br, tr);
                    tri(bl, tr, tl);
                } else {
                    tri(bl, br, tl);
                    tri(br, tr, tl);
                }
            }
        }
        return count;
    }

    private _interiorTriangles(box: THREE.Box3, out: Float32Array, start: number, max: number): number {
        let count = start;
        this._interiors?.shapecast({
            intersectsBounds: (bounds) => box.intersectsBox(bounds),
            intersectsTriangle: (triangle) => {
                if (count >= max) return true;
                _a.copy(triangle.a);
                _b.copy(triangle.b);
                _c.copy(triangle.c);
                if (!triangle.intersectsBox(box)) return false;
                out.set([_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z], count * 9);
                count++;
                return false;
            },
        });
        return count;
    }
}

/**
 * Returns the direction and length skews at `distance` meters from the camera.
 */
function distanceSkew(distance: number): [number, number] {
    for (let i = 1; i < DISTANCE_SKEW.length; i++) {
        const [d1, dir1, len1] = DISTANCE_SKEW[i];
        if (distance <= d1) {
            const [d0, dir0, len0] = DISTANCE_SKEW[i - 1];
            const k = (distance - d0) / (d1 - d0);
            return [dir0 + (dir1 - dir0) * k, len0 + (len1 - len0) * k];
        }
    }
    const last = DISTANCE_SKEW[DISTANCE_SKEW.length - 1];
    return [last[1], last[2]];
}
