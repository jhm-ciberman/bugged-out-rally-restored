import * as THREE from 'three';
import type { ModelLibrary } from '../assets/ModelLibrary';
import type { AudioSystem } from '../audio/AudioSystem';
import { getVehicleData } from '../vehicle/VehicleData';
import { VehicleSounds } from '../vehicle/VehicleSounds';
import { VehicleView } from '../vehicle/VehicleView';
import { type VehicleMove, WheeledVehicle } from '../vehicle/WheeledVehicle';
import type { Track } from '../world/Track';

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

    private _sounds: VehicleSounds | null = null;

    private constructor(
        readonly vehicle: WheeledVehicle,
        readonly view: VehicleView,
    ) {}

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
    }

    /**
     * Runs one physics tick.
     */
    tick(move: VehicleMove): void {
        this._prevPosition.copy(this.vehicle.rigid.linPosition);
        this._prevRotation.copy(this.vehicle.rigid.angPosition);
        this.vehicle.tick(move);
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

    /**
     * Stops the car's sounds.
     */
    dispose(): void {
        this._sounds?.dispose();
    }
}
