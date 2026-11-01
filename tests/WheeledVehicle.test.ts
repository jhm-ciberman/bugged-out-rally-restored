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
        run(car, 15, 1, 0.3);
        // Heading turns clockwise from above: +Y toward +X.
        const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(car.rigid.angPosition);
        expect(forward.x).toBeGreaterThan(0.2);
    });

    it('lets the steering return toward center on ticks without steering input (exe 0x4bd46d)', () => {
        const car = new WheeledVehicle(getVehicleData('Cockroach'), flatWorld());
        car.setTransform(new THREE.Vector3(0, 0, 102), new THREE.Quaternion());
        run(car, 1, 0, 0.5);
        expect(car.steering).toBeCloseTo(0.5);
        run(car, 1, 0, 0);
        expect(car.steering).toBeCloseTo(0.45);
        run(car, 1, 0, 0.1);
        expect(car.steering).toBeCloseTo(0.55);
    });

    it('starts with no boost energy (ShapeBase::onNewDataBlock)', () => {
        const car = new WheeledVehicle(getVehicleData('Cockroach'), flatWorld());
        expect(car.energy).toBe(0);
    });

    it('sinks slower than free fall in deep water', () => {
        const world = flatWorld();
        world.water = {
            min: new THREE.Vector2(-500, -500),
            max: new THREE.Vector2(500, 500),
            bottomZ: 50,
            surfaceZ: 130,
            viscosity: 5,
            density: 1,
        };
        const car = new WheeledVehicle(getVehicleData('Cockroach'), world);
        car.setTransform(new THREE.Vector3(0, 0, 120), new THREE.Quaternion());
        run(car, 20);
        expect(car.waterCoverage).toBe(1);
        // Free fall would reach 30 m/s * 0.64 s = 19.2 m/s (the exe's gravity). Buoyancy (density 1 / 4)
        // and drag (0.6 x viscosity 5) slow it down, but on a 200 kg body only a little, as in Torque.
        const sink = Math.abs(car.rigid.linVelocity.z);
        expect(sink).toBeLessThan(17);
        expect(sink).toBeGreaterThan(8);
    });

    it('puts the center of its box where the body is, even upside down', () => {
        // The Hornet's box is off its origin, so the rotation matters.
        const car = new WheeledVehicle(getVehicleData('Hornet'), flatWorld());
        const upsideDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
        car.setTransform(new THREE.Vector3(0, 0, 110), upsideDown);
        const local = car.data.bounds.getCenter(new THREE.Vector3());
        const expected = local.clone().applyQuaternion(upsideDown).add(car.rigid.linPosition);
        expect(local.z).not.toBe(0);
        expect(car.boxCenter(new THREE.Vector3()).distanceTo(expected)).toBeLessThan(1e-6);
    });
});
