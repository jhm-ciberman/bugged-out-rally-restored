import * as THREE from 'three';
import type { PhysicalZone } from '../physics/CollisionWorld';
import type { MissionObject } from '../torque/MissionFile';
import { parseNumbers, parseVector } from '../torque/TorqueMath';
import { TriggerVolume } from './TriggerVolume';

/** Limits the exe puts on zone settings (`PhysicalZone::onAdd`). */
const MAX_FORCE_COMPONENT = 40000;
const MIN_FRICTION = 0.1;

const _d = new THREE.Vector3();
const _axis = new THREE.Vector3();

/**
 * A mission `PhysicalZone` as the shipped exe runs it: a box that changes tire grip (`surfaceFriction`, ice)
 * and pushes cars with a fixed world force, or, when `centripetal`, swirls them around the box's center
 * (dust devils and water funnels).
 */
export class PhysicalZoneVolume implements PhysicalZone {
    readonly surfaceFriction: number;
    private readonly _box: TriggerVolume;
    private readonly _force: THREE.Vector3;
    private readonly _centripetal: boolean;
    private readonly _axis: THREE.Vector3;
    private readonly _center = new THREE.Vector3();

    constructor(mission: MissionObject) {
        this._box = new TriggerVolume(mission);
        this.surfaceFriction = THREE.MathUtils.clamp(
            Number(mission.fields.get('surfacefriction') ?? 1),
            MIN_FRICTION,
            1,
        );
        const [fx, fy, fz] = parseNumbers(mission.fields.get('appliedforce'), 3);
        const clamp = (v: number) => THREE.MathUtils.clamp(v, -MAX_FORCE_COMPONENT, MAX_FORCE_COMPONENT);
        this._force = new THREE.Vector3(clamp(fx), clamp(fy), clamp(fz));
        this._centripetal = mission.fields.get('centripetal') === '1';
        this._axis = parseVector(mission.fields.get('mcentripetalvector') ?? '0 0 1');
        this._box.center(this._center);
    }

    contains(point: THREE.Vector3): boolean {
        return this._box.contains(point);
    }

    addForce(point: THREE.Vector3, force: THREE.Vector3): void {
        if (!this._centripetal) {
            // Applied as is, in world space; the zone's rotation does not turn it.
            force.add(this._force);
            return;
        }
        // Tangential swirl: |force| * (axis x direction from the center), so nothing pulls inward.
        _d.subVectors(point, this._center).normalize();
        force.add(_axis.crossVectors(this._axis, _d).multiplyScalar(this._force.length()));
    }
}
