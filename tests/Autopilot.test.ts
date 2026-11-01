import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Autopilot } from '../src/ai/Autopilot';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { TERRAIN_SIZE, type TerrainFile } from '../src/torque/TerrainFile';
import { getVehicleData } from '../src/vehicle/VehicleData';
import { WheeledVehicle } from '../src/vehicle/WheeledVehicle';
import { TerrainHeightfield } from '../src/world/TerrainHeightfield';

function flatWorld(): CollisionWorld {
    const file: TerrainFile = {
        version: 3,
        heights: new Float32Array(TERRAIN_SIZE * TERRAIN_SIZE).fill(100),
        materialMap: new Uint8Array(TERRAIN_SIZE * TERRAIN_SIZE),
        materials: [],
    };
    return new CollisionWorld(new TerrainHeightfield(file, -1024, -1024, 8), []);
}

function settle(car: WheeledVehicle) {
    for (let i = 0; i < 40; i++) car.tick({ throttle: 0, yaw: 0, brake: true, jet: false });
}

describe('Autopilot', () => {
    it('gives up after 300 ticks of staying within 2.5 m', () => {
        const car = new WheeledVehicle(getVehicleData('Cockroach'), flatWorld());
        car.setTransform(new THREE.Vector3(0, 0, 102), new THREE.Quaternion());
        const pilot = new Autopilot(car);
        pilot.reset();
        pilot.moveTo(new THREE.Vector3(0, 200, 100));
        let gaveUpAt = -1;
        let tick = 0;
        pilot.onGiveUp = () => {
            if (gaveUpAt < 0) gaveUpAt = tick;
        };
        // The car is never stepped, so it cannot move at all.
        for (; tick < 400 && gaveUpAt < 0; tick++) pilot.nextMove();
        expect(gaveUpAt).toBe(300);
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

    it('drives at full throttle on a straight: the 1.1 base throttle is capped by a 1.0 target', () => {
        const car = new WheeledVehicle(getVehicleData('Cockroach'), flatWorld());
        car.setTransform(new THREE.Vector3(0, 0, 102), new THREE.Quaternion());
        settle(car);
        const pilot = new Autopilot(car);
        pilot.reset();
        pilot.moveTo(new THREE.Vector3(0, 200, 100));
        expect(pilot.nextMove().throttle).toBe(1);
    });

    it('pushes the car toward its destination by 20 N s every tick', () => {
        const car = new WheeledVehicle(getVehicleData('Cockroach'), flatWorld());
        car.setTransform(new THREE.Vector3(0, 0, 102), new THREE.Quaternion());
        settle(car);
        const before = car.rigid.linMomentum.clone();
        const pilot = new Autopilot(car);
        pilot.reset();
        pilot.moveTo(new THREE.Vector3(0, 200, car.rigid.linPosition.z));
        pilot.nextMove();
        const push = car.rigid.linMomentum.clone().sub(before);
        expect(push.y).toBeCloseTo(20);
        expect(push.x).toBeCloseTo(0);
    });

    it('steers toward a glanced item for one tick, then back to the destination', () => {
        const car = new WheeledVehicle(getVehicleData('Cockroach'), flatWorld());
        car.setTransform(new THREE.Vector3(0, 0, 102), new THREE.Quaternion());
        settle(car);
        const pilot = new Autopilot(car);
        pilot.reset();
        pilot.moveTo(new THREE.Vector3(0, 200, 100));
        pilot.glanceAt(new THREE.Vector3(30, 60, 100));
        const toward = pilot.nextMove();
        car.tick(toward);
        const back = pilot.nextMove();
        expect(toward.yaw).toBeGreaterThan(0);
        expect(back.yaw).toBeLessThan(0);
    });
});
