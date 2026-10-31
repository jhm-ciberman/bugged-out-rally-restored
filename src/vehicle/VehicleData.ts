import * as THREE from 'three';
import datablocks from '../game/data/vehicleDatablocks.json';
import shapes from '../game/data/vehicleShapes.json';

/**
 * A tire datablock (`WheeledVehicleTire`).
 */
export interface TireData {
    readonly shapeFile: string;
    /** Half the height of the tire shape, in meters. */
    readonly radius: number;
    readonly staticFriction: number;
    readonly kineticFriction: number;
    readonly lateralForce: number;
    readonly lateralDamping: number;
    readonly lateralRelaxation: number;
    readonly longitudinalForce: number;
    readonly longitudinalDamping: number;
    readonly longitudinalRelaxation: number;
}

/**
 * A suspension spring datablock (`WheeledVehicleSpring`).
 */
export interface SpringData {
    /** Travel from fully extended to fully compressed, in meters. */
    readonly length: number;
    readonly force: number;
    readonly damping: number;
    readonly antiSway: number;
}

/**
 * One wheel mount on a car body.
 */
export interface WheelMount {
    /** Hub position in body space, with the suspension fully extended. */
    readonly position: THREE.Vector3;
    /** Index of the wheel on the other side of the same axle, or -1. */
    readonly opposite: number;
    /** 1 for steering wheels (the front ones), 0 for the others. */
    readonly steering: number;
    readonly tire: TireData;
    readonly spring: SpringData;
}

/**
 * Everything the physics and the camera need about one car type (`WheeledVehicleData`).
 */
export interface VehicleData {
    readonly name: string;
    readonly shapeFile: string;
    readonly mass: number;
    readonly massCenter: THREE.Vector3;
    /** Size of the box used for the moment of inertia (the shape bounds). */
    readonly inertiaBox: THREE.Vector3;
    readonly drag: number;
    /** Body density, for buoyancy in water. */
    readonly density: number;
    readonly bodyFriction: number;
    readonly bodyRestitution: number;
    readonly engineTorque: number;
    readonly engineBrake: number;
    readonly brakeTorque: number;
    readonly maxWheelSpeed: number;
    readonly maxSteeringAngle: number;
    readonly jetForce: number;
    readonly maxEnergy: number;
    readonly jetEnergyDrain: number;
    readonly minJetEnergy: number;
    readonly maxDamage: number;
    readonly speedDamageScale: number;
    readonly minImpactSpeed: number;
    readonly softImpactSpeed: number;
    readonly hardImpactSpeed: number;
    /** Physics sub-steps per 32 ms tick. */
    readonly integration: number;
    readonly collisionTol: number;
    readonly contactTol: number;
    readonly cameraMinDist: number;
    readonly cameraMaxDist: number;
    readonly cameraOffset: number;
    readonly cameraLag: number;
    readonly cameraDecay: number;
    /** Eye node position in body space; the camera looks along the body's Y axis from here. */
    readonly eye: THREE.Vector3;
    /** Camera node position in body space; the chase camera ray starts here. */
    readonly cameraNode: THREE.Vector3;
    /** Weapon mount points in body space: slot 1 (Zinger) and slot 2 (Magno bomb), at nodes `mount1`/`mount2`. */
    readonly mounts: readonly [THREE.Vector3, THREE.Vector3];
    readonly wheels: readonly WheelMount[];
    /** Points of the collision mesh, in body space. */
    readonly collisionHull: readonly THREE.Vector3[];
    readonly bounds: THREE.Box3;
}

type RawBlock = Record<string, unknown>;

interface ShapeJson {
    nodes: Record<string, number[]>;
    bounds: { min: number[]; max: number[] };
    collisionHull: number[][];
}

const num = (block: RawBlock, key: string, fallback: number): number =>
    typeof block[key] === 'number' ? (block[key] as number) : fallback;

const vec = (v: unknown, fallback: number[] = [0, 0, 0]): THREE.Vector3 => {
    const a = Array.isArray(v) ? (v as number[]) : fallback;
    return new THREE.Vector3(a[0], a[1], a[2]);
};

function shapeName(path: string): string {
    return path
        .replace(/^.*\//, '')
        .replace(/\.dts$/i, '')
        .toLowerCase();
}

function tire(name: string): TireData {
    const block = (datablocks.tires as Record<string, RawBlock>)[name];
    const shapeFile = String(block.shapeFile);
    const wheel = (shapes.wheels as Record<string, { bounds: { min: number[]; max: number[] } }>)[shapeName(shapeFile)];
    return {
        shapeFile,
        // WheeledVehicleTire::preload: radius = bounds.len_z() / 2.
        radius: wheel ? (wheel.bounds.max[2] - wheel.bounds.min[2]) / 2 : 0.6,
        staticFriction: num(block, 'staticFriction', 1),
        kineticFriction: num(block, 'kineticFriction', 0.5),
        lateralForce: num(block, 'lateralForce', 10),
        lateralDamping: num(block, 'lateralDamping', 1),
        lateralRelaxation: num(block, 'lateralRelaxation', 1),
        longitudinalForce: num(block, 'longitudinalForce', 10),
        longitudinalDamping: num(block, 'longitudinalDamping', 1),
        longitudinalRelaxation: num(block, 'longitudinalRelaxation', 1),
    };
}

function spring(name: string): SpringData {
    const block = (datablocks.springs as Record<string, RawBlock>)[name];
    return {
        length: num(block, 'length', 1),
        force: num(block, 'force', 10),
        damping: num(block, 'damping', 10),
        antiSway: num(block, 'antiSwayForce', 1),
    };
}

/**
 * Builds the wheel list like `WheeledVehicleData::preload`: hubs in `hubN` order, with
 * wheels on the same axle (within 0.5 m along Y) lined up as mirror pairs.
 */
function buildWheels(nodes: Record<string, number[]>, frontTire: TireData, rearTire: TireData, s: SpringData) {
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) {
        const p = nodes[`hub${i}`];
        if (p) positions.push(vec(p));
    }
    const opposite = positions.map(() => -1);
    for (let i = 0; i < positions.length; i++) {
        for (let j = 0; j < i; j++) {
            if (Math.abs(positions[j].y - positions[i].y) < 0.5) {
                positions[i].set(-positions[j].x, positions[j].y, positions[j].z);
                opposite[i] = j;
                opposite[j] = i;
                break;
            }
        }
    }
    return positions.map(
        (position, i): WheelMount => ({
            position,
            opposite: opposite[i],
            steering: position.y > 0 ? 1 : 0,
            // The onAdd scripts fit the "front" tire to wheels 0 and 1.
            tire: i < 2 ? frontTire : rearTire,
            spring: s,
        }),
    );
}

const cache = new Map<string, VehicleData>();

/**
 * Returns the data of the car named `name` (case-insensitive), such as `Cockroach`.
 *
 * @throws Error when no car has that name.
 */
export function getVehicleData(name: string): VehicleData {
    const key = name.toLowerCase();
    const cached = cache.get(key);
    if (cached) return cached;

    const entry = Object.entries(datablocks.cars as Record<string, RawBlock>).find(([n]) => n.toLowerCase() === key);
    if (!entry) throw new Error(`Unknown car: ${name}`);
    const [carName, block] = entry;
    const shapeFile = String(block.shapeFile);
    const shape = (shapes.cars as unknown as Record<string, ShapeJson>)[shapeName(shapeFile)];
    const nodes = shape.nodes;
    const bounds = new THREE.Box3(vec(shape.bounds.min), vec(shape.bounds.max));

    const hull: THREE.Vector3[] = [];
    for (const p of shape.collisionHull) {
        const v = vec(p);
        if (!hull.some((h) => h.distanceToSquared(v) < 1e-6)) hull.push(v);
    }

    const data: VehicleData = {
        name: carName,
        shapeFile,
        mass: num(block, 'mass', 1),
        massCenter: vec(block.massCenter),
        inertiaBox: bounds.getSize(new THREE.Vector3()),
        drag: num(block, 'drag', 0.7),
        density: num(block, 'density', 4),
        bodyFriction: num(block, 'bodyFriction', 0),
        bodyRestitution: num(block, 'bodyRestitution', 1),
        engineTorque: num(block, 'engineTorque', 1),
        engineBrake: num(block, 'engineBrake', 1),
        brakeTorque: num(block, 'brakeTorque', 1),
        maxWheelSpeed: num(block, 'maxWheelSpeed', 40),
        maxSteeringAngle: num(block, 'maxSteeringAngle', 0.785),
        jetForce: num(block, 'jetForce', 500),
        maxEnergy: num(block, 'maxEnergy', 0),
        jetEnergyDrain: num(block, 'jetEnergyDrain', 0.8),
        minJetEnergy: num(block, 'minJetEnergy', 1),
        maxDamage: num(block, 'maxDamage', 1),
        speedDamageScale: num(block, 'speedDamageScale', 0),
        minImpactSpeed: num(block, 'minImpactSpeed', 25),
        softImpactSpeed: num(block, 'softImpactSpeed', 25),
        hardImpactSpeed: num(block, 'hardImpactSpeed', 50),
        integration: num(block, 'integration', 1),
        collisionTol: num(block, 'collisionTol', 0.1),
        contactTol: num(block, 'contactTol', 0.1),
        cameraMinDist: num(block, 'cameraMinDist', 0.2),
        cameraMaxDist: num(block, 'cameraMaxDist', 0),
        cameraOffset: num(block, 'cameraOffset', 0),
        cameraLag: num(block, 'cameraLag', 0),
        cameraDecay: num(block, 'cameraDecay', 0),
        eye: vec(nodes.eye),
        cameraNode: vec(nodes.cam ?? nodes.eye),
        mounts: [vec(nodes.mount1 ?? nodes.eye), vec(nodes.mount2 ?? nodes.eye)],
        wheels: buildWheels(
            nodes,
            tire(String(block.frontTire)),
            tire(String(block.rearTire)),
            spring(String(block.spring)),
        ),
        collisionHull: hull,
        bounds,
    };
    cache.set(key, data);
    return data;
}

/** Names of the eight playable cars, in datablock order. */
export const VEHICLE_NAMES: readonly string[] = Object.keys(datablocks.cars);
