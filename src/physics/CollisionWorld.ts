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

/**
 * A box of water (`WaterBlock`): everything between `bottomZ` and `surfaceZ` inside the rectangle.
 */
export interface WaterVolume {
    readonly min: THREE.Vector2;
    readonly max: THREE.Vector2;
    readonly bottomZ: number;
    readonly surfaceZ: number;
    readonly viscosity: number;
    readonly density: number;
    /** Whether the block repeats every terrain tile (`tile`, on unless a mission turns it off). */
    readonly tile: boolean;
}

/** Size of a terrain tile; tiled water repeats with the same period (`fluid::IsFluidAtXY`). */
const WATER_TILE = 2048;

/**
 * A box that pushes cars or changes their grip (`PhysicalZone` in the exe). A centripetal zone swirls cars
 * around its vertical axis instead of pushing them one way.
 */
export interface PhysicalZone {
    readonly surfaceFriction: number;
    contains(point: THREE.Vector3): boolean;
    /** Adds this zone's force on an object at `point` to `force`. */
    addForce(point: THREE.Vector3, force: THREE.Vector3): void;
}

/**
 * A moving solid that other bodies collide with as if it were fixed for the instant of contact,
 * like Torque vehicles treat each other.
 */
export interface Obstacle {
    /** The object this obstacle belongs to; it never collides with itself. */
    readonly owner: unknown;
    /** Whether the obstacle is solid right now. */
    enabled: boolean;
    /** Adds a contact to `out` when `point` is within `tolerance` of the obstacle or inside it. */
    contact(point: THREE.Vector3, tolerance: number, out: Contact[]): void;
}

/**
 * A ball-shaped obstacle.
 */
export class SphereObstacle implements Obstacle {
    readonly center = new THREE.Vector3();
    enabled = true;

    constructor(
        readonly owner: unknown,
        public radius: number,
    ) {}

    contact(point: THREE.Vector3, tolerance: number, out: Contact[]): void {
        const offset = point.clone().sub(this.center);
        const length = offset.length();
        const distance = length - this.radius;
        if (distance >= tolerance || length < 1e-6) return;
        out.push({ point: point.clone(), normal: offset.divideScalar(length), distance });
    }
}

/**
 * A box-shaped obstacle that follows a body: `box` in body space, placed by `position` and `rotation`.
 */
export class BoxObstacle implements Obstacle {
    readonly position = new THREE.Vector3();
    enabled = true;
    readonly rotation = new THREE.Quaternion();

    constructor(
        readonly owner: unknown,
        readonly box: THREE.Box3,
    ) {}

    contact(point: THREE.Vector3, tolerance: number, out: Contact[]): void {
        const inv = this.rotation.clone().invert();
        const local = point.clone().sub(this.position).applyQuaternion(inv);
        const b = this.box;
        if (
            local.x < b.min.x - tolerance ||
            local.x > b.max.x + tolerance ||
            local.y < b.min.y - tolerance ||
            local.y > b.max.y + tolerance ||
            local.z < b.min.z - tolerance ||
            local.z > b.max.z + tolerance
        ) {
            return;
        }
        // Push out through the nearest face.
        const faces: [number, THREE.Vector3][] = [
            [local.x - b.max.x, new THREE.Vector3(1, 0, 0)],
            [b.min.x - local.x, new THREE.Vector3(-1, 0, 0)],
            [local.y - b.max.y, new THREE.Vector3(0, 1, 0)],
            [b.min.y - local.y, new THREE.Vector3(0, -1, 0)],
            [local.z - b.max.z, new THREE.Vector3(0, 0, 1)],
            [b.min.z - local.z, new THREE.Vector3(0, 0, -1)],
        ];
        let best = faces[0];
        for (const f of faces) if (f[0] > best[0]) best = f;
        out.push({ point: point.clone(), normal: best[1].applyQuaternion(this.rotation), distance: best[0] });
    }
}

const TERRAIN_RAY_STEP = 0.5;
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _closest = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
const _tri = new THREE.Triangle();

/**
 * Returns the triangles of every mesh under `objects`, in world space, as one non-indexed geometry, or `null`
 * when there are none.
 */
export function mergeWorldTriangles(objects: readonly THREE.Object3D[]): THREE.BufferGeometry | null {
    const geometries: THREE.BufferGeometry[] = [];
    for (const root of objects) {
        root.updateMatrixWorld(true);
        root.traverse((obj) => {
            if (!(obj instanceof THREE.Mesh)) return;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', obj.geometry.getAttribute('position').clone());
            if (obj.geometry.index) g.setIndex(obj.geometry.index.clone());
            g.applyMatrix4(obj.matrixWorld);
            geometries.push(g.index ? g.toNonIndexed() : g);
        });
    }
    return geometries.length > 0 ? mergeGeometries(geometries, false) : null;
}

/**
 * The static solid world a vehicle collides with: the terrain and the interiors (buildings, ramps, fences).
 */
export class CollisionWorld {
    private readonly _bvh: MeshBVH | null;
    private readonly _mesh: THREE.Mesh | null;
    private readonly _raycaster = new THREE.Raycaster();
    /** Moving solids (cars, boulders), refreshed by their owners every tick. */
    readonly obstacles: Obstacle[] = [];
    /** The track's water, if any. */
    water: WaterVolume | null = null;
    /** The mission's gravity scale (`MissionArea.gravityMod`, 0 to 1). */
    gravityMod = 1;
    /** Zones that push cars or change tire grip (`PhysicalZone`). */
    readonly zones: PhysicalZone[] = [];

    /**
     * Whether `point` is inside the track's water (`pointInWater`).
     */
    isInWater(point: THREE.Vector3): boolean {
        const w = this.water;
        if (!w) return false;
        if (point.z < w.bottomZ || point.z > w.surfaceZ) return false;
        let x = point.x - w.min.x;
        let y = point.y - w.min.y;
        if (w.tile) {
            x = THREE.MathUtils.euclideanModulo(x, WATER_TILE);
            y = THREE.MathUtils.euclideanModulo(y, WATER_TILE);
        }
        return x >= 0 && y >= 0 && x <= w.max.x - w.min.x && y <= w.max.y - w.min.y;
    }

    /**
     * Writes the total force of the zones containing `point` into `force` and returns the tire grip
     * multiplier there (`ShapeBase::updateContainer` in the exe: the last zone's friction wins).
     */
    zoneEffects(point: THREE.Vector3, force: THREE.Vector3): number {
        force.set(0, 0, 0);
        let friction = 1;
        for (const zone of this.zones) {
            if (!zone.contains(point)) continue;
            friction = zone.surfaceFriction;
            zone.addForce(point, force);
        }
        return friction;
    }

    /**
     * @param terrain The track terrain.
     * @param solids Objects whose meshes are solid, already placed in the world.
     */
    constructor(
        readonly terrain: TerrainHeightfield,
        solids: readonly THREE.Object3D[],
    ) {
        const merged = mergeWorldTriangles(solids);
        if (merged) {
            this._bvh = new MeshBVH(merged);
            merged.boundsTree = this._bvh;
            // Rays must hit both sides: the engine's ray casts have no back-face rule.
            this._mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
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
    findContacts(
        points: readonly THREE.Vector3[],
        center: THREE.Vector3,
        tolerance: number,
        out: Contact[],
        self: unknown = null,
    ): void {
        for (const obstacle of this.obstacles) {
            if (!obstacle.enabled || obstacle.owner === self) continue;
            for (const p of points) obstacle.contact(p, tolerance, out);
        }

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
            if (_n.lengthSq() < 0.5) continue; // degenerate triangle
            if (_n.dot(_p.subVectors(center, hit.point)) < 0) _n.negate();
            const offset = _p.subVectors(p, hit.point);
            const planeDistance = offset.dot(_n);
            const distance = offset.length();
            if (distance > Math.abs(planeDistance) + 1e-3) {
                // The nearest point is on an edge or corner: use the true distance and the direction to it.
                if (planeDistance < 0 || distance >= tolerance) continue;
                out.push({ point: p.clone(), normal: offset.clone().divideScalar(distance), distance });
            } else if (planeDistance < tolerance) {
                out.push({ point: p.clone(), normal: _n.clone(), distance: planeDistance });
            }
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
