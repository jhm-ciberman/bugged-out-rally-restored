import * as THREE from 'three';
import type { ModelLibrary } from '../assets/ModelLibrary';
import type { AudioSystem } from '../audio/AudioSystem';
import { ChaseCamera } from '../camera/ChaseCamera';
import type { IUpdatable } from '../IUpdatable';
import { VehicleInput } from '../input/VehicleInput';
import type { MissionObject } from '../torque/MissionFile';
import { parseRotation, parseVector } from '../torque/TorqueMath';
import { TICK_SECONDS, type VehicleMove } from '../vehicle/WheeledVehicle';
import type { Track } from '../world/Track';
import { Car } from './Car';
import { Race, type RaceEvents, type Racer } from './Race';

/** Most ticks run in one frame, so a long stall does not freeze the game catching up. */
const MAX_TICKS_PER_FRAME = 8;

const IDLE_MOVE: VehicleMove = { throttle: 0, yaw: 0, brake: false, jet: false };

/**
 * One race on a track: the cars, the rules, the player's controls and the chase camera,
 * all stepped at Torque's fixed 32 ms tick.
 */
export class RaceSession implements IUpdatable {
    readonly race: Race;
    readonly player: Car;
    readonly playerRacer: Racer;
    readonly cars: Car[] = [];
    private _accumulator = 0;

    private constructor(
        readonly track: Track,
        player: Car,
        private readonly _input: VehicleInput,
        private readonly _chase: ChaseCamera,
        events: RaceEvents,
    ) {
        this.race = new Race(track, events);
        this.player = player;
        this.cars.push(player);
        this.playerRacer = this.race.addRacer('Player', player.vehicle);
    }

    /**
     * Sets up a race on `track` with the player in car type `carName` on the first grid spot.
     */
    static async create(
        track: Track,
        models: ModelLibrary,
        carName: string,
        camera: THREE.PerspectiveCamera,
        element: HTMLElement,
        audio: AudioSystem | null,
        events: RaceEvents = {},
    ): Promise<RaceSession> {
        const spot = spawnPoints(track)[0];
        const player = await Car.create(
            carName,
            track,
            models,
            parseVector(spot?.fields.get('position')),
            parseRotation(spot?.fields.get('rotation')),
            audio,
        );
        return new RaceSession(
            track,
            player,
            new VehicleInput(element),
            new ChaseCamera(camera, track.collision),
            events,
        );
    }

    update(deltaSeconds: number): void {
        this._accumulator += deltaSeconds;
        let ticks = 0;
        while (this._accumulator >= TICK_SECONDS && ticks < MAX_TICKS_PER_FRAME) {
            const move = this._input.nextMove();
            if (!this.race.canDrive) move.throttle = 0;
            if (this._input.consumeReset()) this.resetPlayer();
            for (const car of this.cars) car.tick(car === this.player ? move : IDLE_MOVE);
            this.race.tick(TICK_SECONDS);
            this._accumulator -= TICK_SECONDS;
            ticks++;
        }
        if (ticks === MAX_TICKS_PER_FRAME) this._accumulator = 0;

        const alpha = this._accumulator / TICK_SECONDS;
        for (const car of this.cars) car.draw(alpha, deltaSeconds);
        this._chase.update(this.player.vehicle, this.player.renderPosition, this.player.renderRotation);
    }

    /**
     * Puts the player's car back at the last checkpoint it crossed, standing upright.
     */
    resetPlayer(): void {
        const cp = this.playerRacer.lastCheckpoint;
        // Keep only the heading, so a car that crashed upside down comes back on its wheels.
        const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(cp.rotation);
        const yaw = Math.atan2(-forward.x, forward.y);
        const upright = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw);
        this.player.place(cp.position.clone().add(new THREE.Vector3(0, 0, 1)), upright);
    }

    /**
     * Removes the input listeners.
     */
    dispose(): void {
        this._input.dispose();
        for (const car of this.cars) car.dispose();
    }
}

/**
 * Returns the start grid spots of a track (`MissionGroup/PlayerDropPoints`), in order.
 */
export function spawnPoints(track: Track): MissionObject[] {
    const group = track.objects.find((o) => o.className === 'SimGroup' && o.name.toLowerCase() === 'playerdroppoints');
    return group ? group.children.filter((c) => c.className === 'SpawnSphere') : [];
}
