import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { TERRAIN_SIZE, type TerrainFile } from '../src/torque/TerrainFile';
import { getVehicleData, VEHICLE_NAMES } from '../src/vehicle/VehicleData';
import { WheeledVehicle } from '../src/vehicle/WheeledVehicle';
import { TerrainHeightfield } from '../src/world/TerrainHeightfield';

function flatWorld(height = 100): CollisionWorld {
    const file: TerrainFile = {
        version: 3,
        heights: new Float32Array(TERRAIN_SIZE * TERRAIN_SIZE).fill(height),
        materialMap: new Uint8Array(TERRAIN_SIZE * TERRAIN_SIZE),
        materials: [],
    };
    return new CollisionWorld(new TerrainHeightfield(file, -1024, -1024, 8), []);
}

function run(car: WheeledVehicle, ticks: number, throttle = 0, yaw = 0) {
    for (let i = 0; i < ticks; i++) car.tick({ throttle, yaw, brake: false, jet: false });
}

describe('WheeledVehicle', () => {
    it.each(VEHICLE_NAMES)('%s settles on flat ground without sinking or flipping', (name) => {
        const car = new WheeledVehicle(getVehicleData(name), flatWorld());
        car.setTransform(new THREE.Vector3(0, 0, 103), new THREE.Quaternion());
        run(car, 200);
        const up = new THREE.Vector3(0, 0, 1).applyQuaternion(car.rigid.angPosition);
        expect(up.z).toBeGreaterThan(0.99);
        expect(car.speed).toBeLessThan(0.5);
        expect(car.rigid.linPosition.z).toBeGreaterThan(100);
        expect(car.rigid.linPosition.z).toBeLessThan(103);
        expect(car.wheels.every((w) => w.contact)).toBe(true);
    });

    it('drives forward along its Y axis at full throttle', () => {
        const car = new WheeledVehicle(getVehicleData('Cockroach'), flatWorld());
        car.setTransform(new THREE.Vector3(0, 0, 102), new THREE.Quaternion());
        run(car, 60);
        run(car, 150, 1);
        const v = car.rigid.linVelocity;
        expect(v.y).toBeGreaterThan(15);
        expect(Math.abs(v.x)).toBeLessThan(2);
    });

    it('turns right with positive steering', () => {
        const car = new WheeledVehicle(getVehicleData('Cockroach'), flatWorld());
        car.setTransform(new THREE.Vector3(0, 0, 102), new THREE.Quaternion());
        run(car, 60);
        run(car, 60, 1);
        run(car, 1, 1, 0.3);
        run(car, 60, 1);
        // Heading turns clockwise from above: +Y toward +X.
        const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(car.rigid.angPosition);
        expect(forward.x).toBeGreaterThan(0.2);
    });
});
