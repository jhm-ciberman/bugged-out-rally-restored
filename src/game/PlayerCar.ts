import * as THREE from 'three';
import type { ModelLibrary } from '../assets/ModelLibrary';
import { ChaseCamera } from '../camera/ChaseCamera';
import type { IUpdatable } from '../IUpdatable';
import { VehicleInput } from '../input/VehicleInput';
import { getVehicleData } from '../vehicle/VehicleData';
import { VehicleView } from '../vehicle/VehicleView';
import { TICK_SECONDS, WheeledVehicle } from '../vehicle/WheeledVehicle';
import type { Track } from '../world/Track';

/** Most ticks run in one frame, so a long stall does not freeze the game catching up. */
const MAX_TICKS_PER_FRAME = 8;

/**
 * The car the player drives: physics at a fixed 32 ms tick, drawn smoothly between ticks,
 * with the chase camera behind it.
 */
export class PlayerCar implements IUpdatable {
    private _accumulator = 0;
    private readonly _prevPosition = new THREE.Vector3();
    private readonly _prevRotation = new THREE.Quaternion();
    private readonly _renderPosition = new THREE.Vector3();
    private readonly _renderRotation = new THREE.Quaternion();

    private constructor(
        readonly vehicle: WheeledVehicle,
        readonly view: VehicleView,
        private readonly _input: VehicleInput,
        private readonly _chase: ChaseCamera,
    ) {}

    /**
     * Creates car `carName` on `track` at `position`/`rotation`, driven with input from `element`.
     */
    static async create(
        carName: string,
        track: Track,
        models: ModelLibrary,
        camera: THREE.PerspectiveCamera,
        element: HTMLElement,
        position: THREE.Vector3,
        rotation: THREE.Quaternion,
    ): Promise<PlayerCar> {
        const vehicle = new WheeledVehicle(getVehicleData(carName), track.collision);
        vehicle.setTransform(position, rotation);
        const view = await VehicleView.create(vehicle, models);
        const car = new PlayerCar(vehicle, view, new VehicleInput(element), new ChaseCamera(camera, track.collision));
        car._prevPosition.copy(position);
        car._prevRotation.copy(rotation);
        return car;
    }

    update(deltaSeconds: number): void {
        const rigid = this.vehicle.rigid;
        this._accumulator += deltaSeconds;
        let ticks = 0;
        while (this._accumulator >= TICK_SECONDS && ticks < MAX_TICKS_PER_FRAME) {
            this._prevPosition.copy(rigid.linPosition);
            this._prevRotation.copy(rigid.angPosition);
            this.vehicle.tick(this._input.nextMove());
            this._accumulator -= TICK_SECONDS;
            ticks++;
        }
        if (ticks === MAX_TICKS_PER_FRAME) this._accumulator = 0;

        const alpha = this._accumulator / TICK_SECONDS;
        this._renderPosition.lerpVectors(this._prevPosition, rigid.linPosition, alpha);
        this._renderRotation.slerpQuaternions(this._prevRotation, rigid.angPosition, alpha);

        this.vehicle.advanceTime(deltaSeconds);
        this.view.update(this._renderPosition, this._renderRotation);
        this._chase.update(this.vehicle, this._renderPosition, this._renderRotation);
    }

    /**
     * Removes the input listeners.
     */
    dispose(): void {
        this._input.dispose();
    }
}
