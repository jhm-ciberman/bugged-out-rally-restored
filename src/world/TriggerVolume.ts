import * as THREE from 'three';
import type { MissionObject } from '../torque/MissionFile';
import { parseNumbers, parseRotation, parseVector } from '../torque/TorqueMath';

const _local = new THREE.Vector3();

/**
 * A Torque `Trigger`: an oriented box, built from a corner plus three edge vectors (`trigger.cc`).
 */
export class TriggerVolume {
    /** The trigger datablock, such as `CheckPointTrigger`. */
    readonly datablock: string;
    private readonly _inverse = new THREE.Matrix4();
    private readonly _box = new THREE.Box3();

    constructor(readonly mission: MissionObject) {
        this.datablock = mission.fields.get('datablock') ?? '';
        const [ox, oy, oz, ax, ay, az, bx, by, bz, cx, cy, cz] = parseNumbers(
            mission.fields.get('polyhedron') ?? '0 0 0 1 0 0 0 -1 0 0 0 1',
            12,
        );
        const origin = new THREE.Vector3(ox, oy, oz);
        // The box spans origin + {0..1} of each edge vector, in object space before scale.
        for (const corner of [
            [0, 0, 0],
            [1, 1, 1],
        ]) {
            const [i, j, k] = corner;
            this._box.expandByPoint(
                new THREE.Vector3(
                    ox + ax * i + bx * j + cx * k,
                    oy + ay * i + by * j + cy * k,
                    oz + az * i + bz * j + cz * k,
                ),
            );
        }
        this._box.expandByPoint(origin);
        const world = new THREE.Matrix4().compose(
            parseVector(mission.fields.get('position')),
            parseRotation(mission.fields.get('rotation')),
            parseVector(mission.fields.get('scale'), 1),
        );
        this._inverse.copy(world).invert();
    }

    /** The trigger's name in the mission, such as `checkpoint3`. */
    get name(): string {
        return this.mission.name;
    }

    /**
     * Whether the world point `p` is inside the trigger.
     */
    contains(p: THREE.Vector3): boolean {
        return this._box.containsPoint(_local.copy(p).applyMatrix4(this._inverse));
    }

    /**
     * Returns a mission field of the trigger (lower-case name), such as `checkpoint` or `islast`.
     */
    field(name: string): string | undefined {
        return this.mission.fields.get(name);
    }
}
