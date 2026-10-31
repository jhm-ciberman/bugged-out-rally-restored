import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import type { TerrainHeightfield } from '../world/TerrainHeightfield';

/**
 * Where a ray first hit the world.
 */
export interface RayHit {
    /** Fraction of the segment from start (0) to end (1). */
    t: number;
    readonly point: THREE.Vector3;
    readonly normal: THREE.Vector3;
}

/**
 * A point of a moving body that touches or nearly touches the world.
 */
export interface Contact {
    readonly point: THREE.Vector3;
    /** Surface normal, pointing out of the world toward the body. */
    readonly normal: THREE.Vector3;
    /** Separation along the normal. Negative when the point is inside the surface. */
    readonly distance: number;
}

const TERRAIN_RAY_STEP = 0.5;
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _closest = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
const _tri = new THREE.Triangle();

/**
 * The static solid world a vehicle collides with: the terrain and the interiors (buildings, ramps, fences).
 */
export class CollisionWorld {
    private readonly _bvh: MeshBVH | null;
    private readonly _mesh: THREE.Mesh | null;
    private readonly _raycaster = new THREE.Raycaster();

    /**
     * @param terrain The track terrain.
     * @param solids Objects whose meshes are solid, already placed in the world.
     */
    constructor(
        readonly terrain: TerrainHeightfield,
        solids: readonly THREE.Object3D[],
    ) {
        const geometries: THREE.BufferGeometry[] = [];
        for (const solid of solids) {
            solid.updateMatrixWorld(true);
            solid.traverse((obj) => {
                if (!(obj instanceof THREE.Mesh)) return;
                const g = new THREE.BufferGeometry();
                g.setAttribute('position', obj.geometry.getAttribute('position').clone());
                if (obj.geometry.index) g.setIndex(obj.geometry.index.clone());
                g.applyMatrix4(obj.matrixWorld);
                geometries.push(g.index ? g.toNonIndexed() : g);
            });
        }
        if (geometries.length > 0) {
            const merged = mergeGeometries(geometries, false);
            this._bvh = new MeshBVH(merged);
            merged.boundsTree = this._bvh;
            this._mesh = new THREE.Mesh(merged);
            this._mesh.raycast = acceleratedRaycast;
        } else {
            this._bvh = null;
            this._mesh = null;
        }
        this._raycaster.firstHitOnly = true;
    }

    /**
     * Casts a ray from `start` to `end` and returns the first hit, or `null`.
     */
    castRay(start: THREE.Vector3, end: THREE.Vector3): RayHit | null {
        let best = this._castTerrain(start, end);
        if (this._mesh) {
            const dir = _p.subVectors(end, start);
            const len = dir.length();
            if (len > 0) {
                this._raycaster.set(start, dir.divideScalar(len));
                this._raycaster.far = len;
                const hit = this._raycaster.intersectObject(this._mesh, false)[0];
                if (hit?.face && (!best || hit.distance / len < best.t)) {
                    const normal = hit.face.normal.clone();
                    // Interiors are drawn double sided; face the normal toward the ray start.
                    if (normal.dot(this._raycaster.ray.direction) > 0) normal.negate();
                    best = { t: hit.distance / len, point: hit.point.clone(), normal };
                }
            }
        }
        return best;
    }

    /**
     * Finds the points in `points` that are within `tolerance` of a surface, or inside it.
     *
     * @param points World positions of a body's collision hull.
     * @param center A point inside the body, used to tell the outside of thin surfaces.
     */
    findContacts(points: readonly THREE.Vector3[], center: THREE.Vector3, tolerance: number, out: Contact[]): void {
        for (const p of points) {
            const h = this.terrain.heightAt(p.x, p.y);
            if (p.z - h < tolerance + 1) {
                this.terrain.normalAt(p.x, p.y, _n);
                const distance = (p.z - h) * _n.z;
                if (distance < tolerance) out.push({ point: p.clone(), normal: _n.clone(), distance });
            }
        }

        if (!this._bvh) return;
        const geometry = this._bvh.geometry;
        const pos = geometry.getAttribute('position');
        for (const p of points) {
            const hit = this._bvh.closestPointToPoint(p, _closest, 0, 1.5);
            if (!hit) continue;
            const i = hit.faceIndex * 3;
            _tri.setFromAttributeAndIndices(pos, i, i + 1, i + 2);
            _tri.getNormal(_n);
            if (_n.dot(_p.subVectors(center, hit.point)) < 0) _n.negate();
            const distance = _p.subVectors(p, hit.point).dot(_n);
            if (distance < tolerance) out.push({ point: p.clone(), normal: _n.clone(), distance });
        }
    }

    /**
     * Marches a segment over the terrain, then refines the crossing by bisection.
     */
    private _castTerrain(start: THREE.Vector3, end: THREE.Vector3): RayHit | null {
        const len = start.distanceTo(end);
        const steps = Math.max(1, Math.ceil(len / TERRAIN_RAY_STEP));
        const above = (t: number) => {
            _p.lerpVectors(start, end, t);
            return _p.z - this.terrain.heightAt(_p.x, _p.y);
        };
        if (above(0) < 0) return { t: 0, point: start.clone(), normal: new THREE.Vector3(0, 0, 1) };
        let prev = 0;
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            if (above(t) < 0) {
                let lo = prev;
                let hi = t;
                for (let k = 0; k < 12; k++) {
                    const mid = (lo + hi) / 2;
                    if (above(mid) < 0) hi = mid;
                    else lo = mid;
                }
                const point = new THREE.Vector3().lerpVectors(start, end, hi);
                const normal = new THREE.Vector3();
                this.terrain.normalAt(point.x, point.y, normal);
                return { t: hi, point, normal };
            }
            prev = t;
        }
        return null;
    }
}
