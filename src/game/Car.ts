import * as THREE from 'three';
import type { ModelLibrary } from '../assets/ModelLibrary';
import type { AudioSystem } from '../audio/AudioSystem';
import { BoxObstacle } from '../physics/CollisionWorld';
import { getVehicleData } from '../vehicle/VehicleData';
import { VehicleSounds } from '../vehicle/VehicleSounds';
import { VehicleView } from '../vehicle/VehicleView';
import { type VehicleMove, WheeledVehicle } from '../vehicle/WheeledVehicle';
import type { Track } from '../world/Track';

/**
 * Why a car took damage. Zone damage (death zones, cacti) bypasses scoring in the original.
 */
export interface DamageCause {
    readonly kind: 'impact' | 'projectile' | 'water' | 'zone';
    /** The car that fired, for projectile damage. */
    readonly source: Car | null;
}

/** Energy a boost pad gives (`setBoostLevel(100)` in boostpad.cs). */
const BOOST_LEVEL = 100;

/** Smallest crash damage that counts (`WheeledVehicleData::onImpact`). */
const IMPACT_DAMAGE_THRESHOLD = 4.5;

/**
 * A car on the track: its physics body plus its model, drawn smoothly between physics ticks.
 */
export class Car {
    /** Pose at the start of the current tick, for drawing between ticks. */
    private readonly _prevPosition = new THREE.Vector3();
    private readonly _prevRotation = new THREE.Quaternion();
    /** Pose the car is drawn at this frame. */
    readonly renderPosition = new THREE.Vector3();
    readonly renderRotation = new THREE.Quaternion();

    /** Zinger rockets carried. */
    rockets = 0;
    /** Magno bombs carried. */
    bombs = 0;
    /** Damage taken; the car is wrecked at `vehicle.data.maxDamage`. */
    damage = 0;
    /** What wrecked the car last, for scoring. */
    wreckCause: DamageCause | null = null;
    /** Kill score: +1 per car wrecked, -1 per own wreck (`GameConnection::onDeath`). */
    score = 0;

    private _sounds: VehicleSounds | null = null;

    /** Set by a boost pad: the car jets until its energy runs out (native `setBoostLevel`). */
    boosting = false;
    /** Seconds left before a wrecked car comes back, or 0 while driving. */
    respawnTimer = 0;

    /** The car's body as a solid for other cars and rolling objects. */
    readonly obstacle: BoxObstacle;

    private constructor(
        readonly vehicle: WheeledVehicle,
        readonly view: VehicleView,
    ) {
        vehicle.onImpact = (change) => this._impact(change.length());
        const hull = new THREE.Box3().setFromPoints([...vehicle.data.collisionHull]);
        this.obstacle = new BoxObstacle(vehicle, hull);
    }

    /**
     * Creates car type `carName` on `track` at the given pose.
     */
    static async create(
        carName: string,
        track: Track,
        models: ModelLibrary,
        position: THREE.Vector3,
        rotation: THREE.Quaternion,
        audio: AudioSystem | null = null,
    ): Promise<Car> {
        const vehicle = new WheeledVehicle(getVehicleData(carName), track.collision);
        const car = new Car(vehicle, await VehicleView.create(vehicle, models));
        car.place(position, rotation);
        if (audio) car._sounds = await VehicleSounds.create(vehicle, audio, car.view.object);
        return car;
    }

    /**
     * Teleports the car and stops it.
     */
    place(position: THREE.Vector3, rotation: THREE.Quaternion): void {
        this.vehicle.setTransform(position, rotation);
        this._prevPosition.copy(position);
        this._prevRotation.copy(rotation);
        this.renderPosition.copy(position);
        this.renderRotation.copy(rotation);
        this.obstacle?.position.copy(position);
        this.obstacle?.rotation.copy(rotation);
    }

    /**
     * Runs one physics tick.
     */
    tick(move: VehicleMove): void {
        this._prevPosition.copy(this.vehicle.rigid.linPosition);
        this._prevRotation.copy(this.vehicle.rigid.angPosition);
        if (this.boosting) {
            move.jet = true;
            if (this.vehicle.energy <= 0) this.boosting = false;
        }
        this.vehicle.tick(move);
        this.obstacle.position.copy(this.vehicle.rigid.linPosition);
        this.obstacle.rotation.copy(this.vehicle.rigid.angPosition);
    }

    /**
     * Updates the drawn pose and the frame effects.
     *
     * @param alpha How far the frame is between the previous tick and the current one (0 to 1).
     */
    draw(alpha: number, deltaSeconds: number): void {
        const rigid = this.vehicle.rigid;
        this.renderPosition.lerpVectors(this._prevPosition, rigid.linPosition, alpha);
        this.renderRotation.slerpQuaternions(this._prevRotation, rigid.angPosition, alpha);
        this.vehicle.advanceTime(deltaSeconds);
        this.view.update(this.renderPosition, this.renderRotation);
        this._sounds?.update();
    }

    /** Remaining health, 0 to 1. */
    get health(): number {
        return Math.max(0, 1 - this.damage / this.vehicle.data.maxDamage);
    }

    /** Whether the car has taken enough damage to be wrecked. */
    get isWrecked(): boolean {
        return this.damage >= this.vehicle.data.maxDamage;
    }

    /**
     * Fills the boost energy and starts jetting, like a boost pad (`setBoostLevel(100)`).
     *
     * What the native flag does is not known; jetting until the energy is gone is the closest stock behavior.
     */
    startBoost(): void {
        // setBoostLevel(100) goes through setEnergyLevel, which caps at the car's maximum.
        this.vehicle.energy = Math.min(BOOST_LEVEL, this.vehicle.data.maxEnergy);
        this.boosting = true;
    }

    /**
     * Adds damage, up to the wreck level.
     */
    applyDamage(amount: number, cause: DamageCause = { kind: 'zone', source: null }): void {
        if (this.isWrecked) return;
        this.damage = Math.min(this.vehicle.data.maxDamage, this.damage + Math.abs(amount));
        if (this.isWrecked) this.wreckCause = cause;
    }

    /**
     * Stops the car's sounds.
     */
    dispose(): void {
        this._sounds?.dispose();
    }

    private _impact(speed: number): void {
        this._sounds?.impact(speed);
        // WheeledVehicleData::onImpact: damage only for hits above 4.5.
        const damage = speed * this.vehicle.data.speedDamageScale;
        if (damage > IMPACT_DAMAGE_THRESHOLD) this.applyDamage(damage, { kind: 'impact', source: null });
    }
}
