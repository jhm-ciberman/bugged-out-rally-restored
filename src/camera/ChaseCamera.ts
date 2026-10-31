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
const _eyeRotation = new THREE.Quaternion();
/** How fast the camera slides between the eye and the chase position, in full trips per second (`mCameraSpeed`). */
const CAMERA_SPEED = 10;
/** three.js cameras look down -Z with +Y up; this turns a Torque frame (+Y forward, +Z up) into one. */
const TORQUE_TO_CAMERA = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

/**
 * The vehicle camera (`Vehicle::getCameraTransform` with `cameraRoll` off). The chase view sits behind
 * the car along its forward axis, kept upright, pulled in when something is in the way. The first person
 * view looks out of the car's eye node.
 */
export class ChaseCamera {
    /** 0 at the eye, 1 at the full chase distance (`mCameraPos`). */
    private _distance = 1;

    constructor(
        readonly camera: THREE.PerspectiveCamera,
        private readonly _world: CollisionWorld,
    ) {}

    /**
     * Places the camera for `vehicle`, drawn at `position` and `rotation`.
     *
     * @param firstPerson Whether to move toward the eye view instead of the chase view.
     * @param dt Seconds since the last update, for the slide between the two views.
     */
    update(
        vehicle: WheeledVehicle,
        position: THREE.Vector3,
        rotation: THREE.Quaternion,
        firstPerson: boolean,
        dt: number,
    ): void {
        const data = vehicle.data;
        const step = CAMERA_SPEED * dt;
        this._distance = THREE.MathUtils.clamp(this._distance + (firstPerson ? -step : step), 0, 1);

        if (this._distance === 0) {
            // The eye view rolls and pitches with the car.
            this.camera.position.copy(data.eye).applyQuaternion(rotation).add(position);
            this.camera.quaternion.copy(_eyeRotation.copy(rotation).multiply(TORQUE_TO_CAMERA));
            return;
        }

        // Upright frame that looks along the eye's forward axis.
        _forward.set(0, 1, 0).applyQuaternion(rotation);
        _x.crossVectors(_forward, new THREE.Vector3(0, 0, 1)).normalize();
        _z.crossVectors(_x, _forward).normalize();

        // Ray from the camera node, back along the eye's -Y by (max - min) distance.
        _start.copy(data.cameraNode).applyQuaternion(rotation).add(position);
        _vec.copy(_forward).multiplyScalar(-(data.cameraMaxDist - data.cameraMinDist) * this._distance);
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
        this.camera.quaternion.setFromRotationMatrix(_m);
        this.camera.position.copy(_end);
    }
}
