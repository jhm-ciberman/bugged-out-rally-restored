import * as THREE from 'three';
import type { ModelLibrary } from '../assets/ModelLibrary';
import type { WheeledVehicle } from './WheeledVehicle';

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Draws a {@link WheeledVehicle}: the body plus a wheel on each hub (`WheeledVehicle::renderImage`).
 */
export class VehicleView {
    readonly object = new THREE.Group();
    private readonly _wheels: THREE.Object3D[] = [];

    private constructor(private readonly _vehicle: WheeledVehicle) {}

    /**
     * Loads the body and wheel models of `vehicle`.
     */
    static async create(vehicle: WheeledVehicle, models: ModelLibrary): Promise<VehicleView> {
        const view = new VehicleView(vehicle);
        const body = await models.instantiate(vehicle.data.shapeFile);
        if (body) view.object.add(body);
        for (const w of vehicle.wheels) {
            const wheel = (await models.instantiate(w.mount.tire.shapeFile)) ?? new THREE.Object3D();
            view._wheels.push(wheel);
            view.object.add(wheel);
        }
        view.object.name = vehicle.data.name;
        return view;
    }

    /**
     * Places the body at the given pose and updates the wheels from the vehicle state.
     */
    update(position: THREE.Vector3, rotation: THREE.Quaternion): void {
        this.object.position.copy(position);
        this.object.quaternion.copy(rotation);
        const steer = new THREE.Quaternion();
        const spin = new THREE.Quaternion();
        const face = new THREE.Quaternion();
        this._vehicle.wheels.forEach((w, i) => {
            const wheel = this._wheels[i];
            const pos = w.mount.position;
            wheel.position.set(pos.x, pos.y, pos.z - w.mount.spring.length * w.extension);
            // Torque Euler angles turn the opposite way from three.js, hence the minus signs.
            steer.setFromAxisAngle(Z_AXIS, -this._vehicle.steering * w.mount.steering);
            spin.setFromAxisAngle(X_AXIS, -w.apos * Math.PI * 2);
            face.setFromAxisAngle(Z_AXIS, pos.x > 0 ? -Math.PI / 2 : Math.PI / 2);
            wheel.quaternion.copy(steer).multiply(spin).multiply(face);
        });
    }
}
