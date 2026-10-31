import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Autopilot } from '../src/ai/Autopilot';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { TERRAIN_SIZE, type TerrainFile } from '../src/torque/TerrainFile';
import { getVehicleData } from '../src/vehicle/VehicleData';
import { WheeledVehicle } from '../src/vehicle/WheeledVehicle';
import { TerrainHeightfield } from '../src/world/TerrainHeightfield';

function flatWorld(solids: THREE.Object3D[] = []): CollisionWorld {
    const file: TerrainFile = {
        version: 3,
        heights: new Float32Array(TERRAIN_SIZE * TERRAIN_SIZE).fill(100),
        materialMap: new Uint8Array(TERRAIN_SIZE * TERRAIN_SIZE),
        materials: [],
    };
    return new CollisionWorld(new TerrainHeightfield(file, -1024, -1024, 8), solids);
}

/** A wide, tall wall across the Y axis at `y`. */
function wall(y: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400));
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(0, y, 100);
    mesh.updateMatrixWorld();
    return mesh;
}

function settle(car: WheeledVehicle) {
    for (let i = 0; i < 40; i++) car.tick({ throttle: 0, yaw: 0, brake: true, jet: false });
}

describe('Autopilot', () => {
    it('gives up within about 300 ticks when it is pinned and cannot move 2.5 m', () => {
        // Walls just in front of and behind the car (it is about 6.5 m long).
        const car = new WheeledVehicle(getVehicleData('Cockroach'), flatWorld([wall(4.5), wall(-4.5)]));
        car.setTransform(new THREE.Vector3(0, 0, 102), new THREE.Quaternion());
        settle(car);
        const pilot = new Autopilot(car);
        pilot.reset();
        pilot.moveTo(new THREE.Vector3(0, 200, 100));
        let gaveUpAt = -1;
        pilot.onGiveUp = () => {
            if (gaveUpAt < 0) gaveUpAt = tick;
        };
        let tick = 0;
        for (; tick < 600 && gaveUpAt < 0; tick++) car.tick(pilot.nextMove());
        // 300 stuck ticks, plus a few if the first crash bounces the car out of the 2.5 m circle.
        expect(gaveUpAt).toBeGreaterThan(300);
        expect(gaveUpAt).toBeLessThan(450);
    });

    it('counts a marker as reached once the car has driven past it', () => {
        const car = new WheeledVehicle(getVehicleData('Cockroach'), flatWorld());
        car.setTransform(new THREE.Vector3(0, 0, 102), new THREE.Quaternion());
        settle(car);
        const pilot = new Autopilot(car);
        pilot.reset();
        let reached = false;
        pilot.onReach = () => {
            reached = true;
        };
        pilot.moveTo(new THREE.Vector3(30, 50, 100));
        // Teleport the car well past the marker, 20 m to its side (outside the 12 m square).
        car.setTransform(new THREE.Vector3(10, 80, 102), new THREE.Quaternion());
        pilot.nextMove();
        expect(reached).toBe(true);
    });
});
