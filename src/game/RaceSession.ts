import * as THREE from 'three';
import { Bot } from '../ai/Bot';
import { botRoster, type RaceEvent } from '../ai/BotRoster';
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
 * How to set up a race.
 */
export interface RaceSetup {
    readonly track: Track;
    readonly models: ModelLibrary;
    /** Car type the player drives, such as `Cockroach`. */
    readonly carName: string;
    readonly event: RaceEvent;
    /** The player's total winnings, which pick the opponents' cars. */
    readonly winnings: number;
    readonly camera: THREE.PerspectiveCamera;
    /** Element that captures the mouse for steering. */
    readonly element: HTMLElement;
    readonly audio: AudioSystem | null;
    readonly events?: RaceEvents;
}

/**
 * One race on a track: the cars, the bots, the rules, the player's controls and the chase camera,
 * all stepped at Torque's fixed 32 ms tick.
 */
export class RaceSession implements IUpdatable {
    readonly race: Race;
    readonly player: Car;
    readonly playerRacer: Racer;
    readonly cars: Car[] = [];
    readonly bots: Bot[] = [];
    private _accumulator = 0;
    private _botsStarted = false;

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
     * Sets up a race: the player on the first grid spot and the bots on the next ones.
     */
    static async create(setup: RaceSetup): Promise<RaceSession> {
        const { track, models, audio } = setup;
        const spots = spawnPoints(track);
        const at = (i: number) => {
            const spot = spots[i] ?? spots[0];
            return [parseVector(spot?.fields.get('position')), parseRotation(spot?.fields.get('rotation'))] as const;
        };
        const player = await Car.create(setup.carName, track, models, ...at(0), audio);
        const session = new RaceSession(
            track,
            player,
            new VehicleInput(setup.element),
            new ChaseCamera(setup.camera, track.collision),
            setup.events ?? {},
        );

        const roster = botRoster(setup.event, setup.winnings);
        const cars = await Promise.all(roster.map((b, i) => Car.create(b.car, track, models, ...at(i + 1), audio)));
        roster.forEach((entry, i) => {
            const car = cars[i];
            const racer = session.race.addRacer(entry.name, car.vehicle);
            const bot = new Bot(car, racer, track, i);
            racer.onCheckpoint = () => bot.markCheckpoint();
            session.cars.push(car);
            session.bots.push(bot);
        });
        return session;
    }

    update(deltaSeconds: number): void {
        this._accumulator += deltaSeconds;
        let ticks = 0;
        while (this._accumulator >= TICK_SECONDS && ticks < MAX_TICKS_PER_FRAME) {
            this._tick();
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
     * Removes the input listeners and stops the sounds.
     */
    dispose(): void {
        this._input.dispose();
        for (const car of this.cars) car.dispose();
    }

    private _tick(): void {
        const racing = this.race.canDrive;
        if (racing && !this._botsStarted) {
            this._botsStarted = true;
            for (const bot of this.bots) bot.start();
        }

        const move = this._input.nextMove();
        // The throttle is ignored until the green light; steering and brakes are not (`moveForward`).
        if (!racing) move.throttle = 0;
        if (this._input.consumeReset()) this.resetPlayer();
        this.player.tick(move);
        for (const bot of this.bots) bot.car.tick(racing ? bot.nextMove(TICK_SECONDS) : IDLE_MOVE);

        this.race.tick(TICK_SECONDS);
    }
}

/**
 * Returns the start grid spots of a track (`MissionGroup/PlayerDropPoints`), in order.
 */
export function spawnPoints(track: Track): MissionObject[] {
    const group = track.objects.find((o) => o.className === 'SimGroup' && o.name.toLowerCase() === 'playerdroppoints');
    return group ? group.children.filter((c) => c.className === 'SpawnSphere') : [];
}
