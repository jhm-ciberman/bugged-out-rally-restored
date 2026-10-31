import * as THREE from 'three';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { WheeledVehicle } from '../vehicle/WheeledVehicle';

const _forward = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _start = new THREE.Vector3();
const _vec = new THREE.Vector3();
const _end = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * The third-person vehicle camera (`Vehicle::getCameraTransform` with `cameraRoll` off):
 * behind the car along its forward axis, kept upright, pulled in when something is in the way.
 */
export class ChaseCamera {
    constructor(
        private readonly _camera: THREE.PerspectiveCamera,
        private readonly _world: CollisionWorld,
    ) {}

    /**
     * Places the camera behind `vehicle`, drawn at `position` and `rotation`.
     */
    update(vehicle: WheeledVehicle, position: THREE.Vector3, rotation: THREE.Quaternion): void {
        const data = vehicle.data;

        // Upright frame that looks along the eye's forward axis.
        _forward.set(0, 1, 0).applyQuaternion(rotation);
        _x.crossVectors(_forward, new THREE.Vector3(0, 0, 1)).normalize();
        _z.crossVectors(_x, _forward).normalize();

        // Ray from the camera node, back along the eye's -Y by (max - min) distance.
        _start.copy(data.cameraNode).applyQuaternion(rotation).add(position);
        _vec.copy(_forward).multiplyScalar(-(data.cameraMaxDist - data.cameraMinDist));
        const offset = new THREE.Vector3(0, 0, data.cameraOffset).add(vehicle.cameraOffset);
        _end.copy(_start).add(_vec).add(offset);

        const hit = this._world.castRay(_start, _end);
        if (hit) {
            // Pull the camera in front of what it hit, with a little margin.
            const t = hit.t - (-_vec.dot(hit.normal) / _vec.length()) * 0.1;
            if (t > 0) _end.copy(_start).add(offset).addScaledVector(_vec, t);
            else _end.copy(data.eye).applyQuaternion(rotation).add(position);
        }

        // three.js cameras look down -Z with +Y up.
        _m.makeBasis(_x, _z, _forward.clone().negate());
        this._camera.quaternion.setFromRotationMatrix(_m);
        this._camera.position.copy(_end);
    }
}
