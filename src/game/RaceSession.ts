import * as THREE from 'three';
import { Bot } from '../ai/Bot';
import { botRoster, type RaceEvent } from '../ai/BotRoster';
import type { ModelLibrary } from '../assets/ModelLibrary';
import type { AudioSystem } from '../audio/AudioSystem';
import { ChaseCamera } from '../camera/ChaseCamera';
import type { IUpdatable } from '../IUpdatable';
import { VehicleInput } from '../input/VehicleInput';
import {
    BUG_BUBBLE,
    BUG_SPLASH,
    BUG_SPLASH_MIST,
    ejectionDirection,
    type ParticleLook,
    TIRE_DUST,
} from '../render/Particles';
import type { MissionObject } from '../torque/MissionFile';
import { parseRotation, parseVector } from '../torque/TorqueMath';
import { TICK_SECONDS, type VehicleMove } from '../vehicle/WheeledVehicle';
import { Combat, type Triggers } from '../weapons/Combat';
import { VEHICLE_EXPLOSION, VEHICLE_WATER_EXPLOSION } from '../weapons/Explosions';
import type { Track } from '../world/Track';
import { Car } from './Car';
import { Hazards } from './Hazards';
import { Pickups } from './Pickups';
import { Race, type RaceEvents, type Racer } from './Race';
import { Zones } from './Zones';

/** Most ticks run in one frame, so a long stall does not freeze the game catching up. */
const MAX_TICKS_PER_FRAME = 8;
/** Water damage per period (`$DamageWater`, rescheduled every 50 ms). */
const WATER_DAMAGE = 0.075;
/** Milliseconds of emitter time per dust particle (`tireEmitter.ejectionPeriodMS`). */
const DUST_PERIOD_MS = 10;
const WATER_DAMAGE_PERIOD = 0.05;
/** Car speed below which the water does not splash (`splashVelEpsilon`, the same for every car). */
const SPLASH_VEL_EPSILON = 0.6;
/** Milliseconds of splash emission per m/s per second (`splashFreqMod`). */
const SPLASH_FREQ_MOD = 300;

interface SplashEmitter {
    readonly look: ParticleLook;
    readonly periodMs: number;
    readonly speed: number;
    readonly speedVariance: number;
    readonly thetaMin: number;
    readonly thetaMax: number;
    readonly phiVariance: number;
    readonly offset: number;
    readonly inherit: number;
}

/**
 * The car splash emitters (`BugSplashEmitter`, `BugSplashMistEmitter`, `BugBubbleEmitter`).
 *
 * In the original the first two have a `lifetimeMS` of 100 and 250, and an emitter's clock starts when the car
 * is created, so they stop for good right after spawning and only the bubbles show. That looks unintended,
 * so here all three keep emitting.
 */
const SPLASH_EMITTERS: readonly SplashEmitter[] = [
    {
        look: BUG_SPLASH,
        periodMs: 10,
        speed: 3,
        speedVariance: 1,
        thetaMin: 60,
        thetaMax: 120,
        phiVariance: 90,
        offset: 0,
        inherit: 0.2,
    },
    {
        look: BUG_SPLASH_MIST,
        periodMs: 10,
        speed: 3,
        speedVariance: 2,
        thetaMin: 0,
        thetaMax: 90,
        phiVariance: 360,
        offset: 0,
        inherit: 0,
    },
    {
        look: BUG_BUBBLE,
        periodMs: 20,
        speed: 4,
        speedVariance: 0.5,
        thetaMin: 0,
        thetaMax: 120,
        phiVariance: 360,
        offset: 0.5,
        inherit: 0,
    },
];
const _surface = new THREE.Vector3();

/** Seconds a wrecked car stays gone before it reappears at its last checkpoint (native `onDestroy`). */
const RESPAWN_SECONDS = 4;

/** A move with no input. A new object each time, because cars change the move they are given. */
const idleMove = (brake = false): VehicleMove => ({ throttle: 0, yaw: 0, brake, jet: false });

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
    readonly pickups: Pickups;
    readonly zones: Zones;
    /** Weapons, projectiles and explosions. Add `combat.object` to the scene. */
    readonly combat: Combat;
    readonly hazards: Hazards;
    private _accumulator = 0;
    private readonly _dustBudget = new Map<Car, number>();
    private _botsStarted = false;
    /** Unspent emission per car and splash emitter, in particles. */
    private readonly _splashBudget = new Map<Car, number[]>();
    /** Looping sounds placed in the mission (`AudioEmitter`). */
    private readonly _ambient: THREE.PositionalAudio[] = [];
    private _ambientStopped = false;

    private constructor(
        readonly track: Track,
        player: Car,
        combat: Combat,
        private readonly _input: VehicleInput,
        private readonly _chase: ChaseCamera,
        events: RaceEvents,
    ) {
        this.race = new Race(track, events);
        this.pickups = new Pickups(track.items);
        this.zones = new Zones(track);
        this.combat = combat;
        this.hazards = new Hazards(track, combat, combat.models, combat.audio);
        combat.onDamage = ({ target, source, amount }) => target.applyDamage(amount, { kind: 'projectile', source });
        this.player = player;
        this.cars.push(player);
        this.playerRacer = this.race.addRacer('Player', player.vehicle);
    }

    /** Whether the player's keys and mouse drive the car. Off while a menu or the scoreboard is up. */
    get inputEnabled(): boolean {
        return this._input.enabled;
    }

    set inputEnabled(enabled: boolean) {
        this._input.enabled = enabled;
    }

    /** When set, the race leaves the camera alone (for a debug fly camera). */
    freeCamera = false;

    /** Whether the player picked the first person view. */
    get firstPerson(): boolean {
        return this._input.firstPerson;
    }

    /** Horizontal field of view the player's camera asks for, in degrees. */
    get cameraFov(): number {
        return this._input.fov;
    }

    /**
     * Sets up a race: the bots on the first grid spots and the player on the one after them.
     */
    static async create(setup: RaceSetup): Promise<RaceSession> {
        const { track, models, audio } = setup;
        const spots = spawnPoints(track);
        const at = (i: number) => {
            const spot = spots[i] ?? spots[0];
            return [parseVector(spot?.fields.get('position')), parseRotation(spot?.fields.get('rotation'))] as const;
        };
        const roster = botRoster(setup.event, setup.winnings);
        // Each car takes the next spot in the order the cars enter the race (`GameConnection::spawnPlayer`), and
        // the bots enter before the player (in the original, with three bots the player starts on the fourth spot).
        const player = await Car.create(setup.carName, track, models, ...at(roster.length), audio);
        const session = new RaceSession(
            track,
            player,
            new Combat(track.collision, models, audio),
            new VehicleInput(setup.element),
            new ChaseCamera(setup.camera, track.collision),
            setup.events ?? {},
        );

        const cars = await Promise.all(roster.map((b, i) => Car.create(b.car, track, models, ...at(i), audio)));
        roster.forEach((entry, i) => {
            const car = cars[i];
            const racer = session.race.addRacer(entry.name, car.vehicle);
            const bot = new Bot(car, racer, track, i);
            bot.autopilot.onGiveUp = () => session.respawnLater(car);
            racer.onCheckpoint = () => bot.markCheckpoint();
            session.cars.push(car);
            session.bots.push(bot);
        });
        // Cars are solid to each other. A wrecked car leaves the list until it comes back.
        for (const car of session.cars) track.collision.obstacles.push(car.obstacle);
        if (audio) await session._startAmbientSounds(audio);
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
        for (const car of this.cars) {
            car.draw(alpha, deltaSeconds);
            this._emitDust(car, deltaSeconds);
            this._splash(car, deltaSeconds);
        }
        this.combat.update(deltaSeconds, alpha);
        this.hazards.update();
        if (this.freeCamera) return;
        this._chase.update(
            this.player.vehicle,
            this.player.renderPosition,
            this.player.renderRotation,
            this._input.firstPerson,
            deltaSeconds,
        );
        this._chase.camera.position.add(this.combat.cameraShake(this._chase.camera.position));
    }

    /**
     * Puts the player's car back at the last checkpoint it crossed, standing upright.
     */
    resetPlayer(): void {
        this._placeAtCheckpoint(this.player);
    }

    /**
     * Takes a car out of the race: it loses its ammo, disappears and comes back at its last
     * checkpoint after a few seconds (`WheeledVehicleData::onDestroyed`).
     */
    wreck(car: Car): void {
        if (car.respawnTimer > 0) return;
        car.respawnTimer = RESPAWN_SECONDS;
        // Scoring (`GameConnection::onDeath`): a crash costs a point; a kill also gives the shooter one.
        // Zone damage goes around onDeath, so it does not score, and nothing scores once the player has
        // finished (`$Game::Cycling`).
        const cause = car.wreckCause;
        if (cause && cause.kind !== 'zone' && this.playerRacer.finishTime === null) {
            car.score--;
            if (cause.source && cause.source !== car) cause.source.score++;
        }
        car.wreckCause = null;
        car.rockets = 0;
        car.bombs = 0;
        car.boosting = false;
        car.view.object.visible = false;
        car.obstacle.enabled = false;
        // The car blows up from the middle of its box (`ShapeBase::blowUp`), with a water version under water.
        const center = car.vehicle.boxCenter(new THREE.Vector3());
        const inWater = this.track.collision.isInWater(center);
        this.combat.explode(inWater ? VEHICLE_WATER_EXPLOSION : VEHICLE_EXPLOSION, center);
    }

    /**
     * Removes the input listeners and stops the sounds.
     */
    /**
     * Puts a hopelessly stuck car back at its last checkpoint after a few seconds. Unlike a wreck,
     * it stays visible and keeps its ammo (native `onDestroy` for AI only arms a timer).
     */
    respawnLater(car: Car): void {
        if (car.respawnTimer > 0) return;
        car.respawnTimer = RESPAWN_SECONDS;
    }

    dispose(): void {
        const obstacles = this.track.collision.obstacles;
        for (const car of this.cars) obstacles.splice(obstacles.indexOf(car.obstacle), 1);
        this._input.dispose();
        this._ambientStopped = true;
        for (const sound of this._ambient) if (sound.isPlaying) sound.stop();
        this.pickups.dispose();
        this.combat.dispose();
        for (const car of this.cars) car.dispose();
    }

    /**
     * Starts the mission's looping sound emitters (frogs at the pond, dust devils, the sea).
     */
    private async _startAmbientSounds(audio: AudioSystem): Promise<void> {
        for (const obj of this.track.objects) {
            if (obj.className !== 'AudioEmitter' || obj.fields.get('islooping') === '0') continue;
            const minGap = Number(obj.fields.get('minloopgap') ?? 0) / 1000;
            const maxGap = Math.max(minGap, Number(obj.fields.get('maxloopgap') ?? 0) / 1000);
            const sound = await audio.loop(obj.fields.get('profile') ?? '');
            if (!sound) continue;
            // With useProfileDescription the profile sets the distances; otherwise the emitter does.
            if (obj.fields.get('useprofiledescription') !== '1') {
                sound.setRefDistance(Number(obj.fields.get('referencedistance') ?? 1));
                sound.setVolume(Number(obj.fields.get('volume') ?? 1));
            }
            sound.position.copy(parseVector(obj.fields.get('position')));
            this.combat.object.add(sound);
            if (maxGap > 0) {
                // With a loop gap the emitter plays the sound once, waits, and plays it again.
                sound.setLoop(false);
                const ended = sound.onEnded.bind(sound);
                sound.onEnded = () => {
                    ended();
                    const gap = minGap + Math.random() * (maxGap - minGap);
                    setTimeout(() => {
                        if (!this._ambientStopped) sound.play();
                    }, gap * 1000);
                };
            }
            sound.play();
            this._ambient.push(sound);
        }
    }

    /**
     * Splashes where a car meets the water surface, more the faster it goes, and plays its water sounds
     * (`Vehicle::updateFroth`, `collidingWithWater`).
     */
    private _splash(car: Car, dt: number): void {
        const water = this.track.collision.water;
        const p = car.vehicle.rigid.linPosition;
        const height = car.vehicle.data.bounds.max.z - car.vehicle.data.bounds.min.z;
        // The engine casts a ray down from the top of the box to the car's origin, looking for the surface.
        const touching =
            water !== null &&
            car.respawnTimer <= 0 &&
            this.track.collision.isInWater(_surface.set(p.x, p.y, water.surfaceZ)) &&
            p.z <= water.surfaceZ &&
            p.z + height >= water.surfaceZ;
        car.waterSounds(touching);
        if (!touching || !water) return;

        const velocity = car.vehicle.rigid.linVelocity;
        let speed = velocity.length();
        if (speed < SPLASH_VEL_EPSILON) speed = 0;
        // Milliseconds of emission this frame (`splashFreqMod`).
        const ms = speed * SPLASH_FREQ_MOD * dt;
        let budgets = this._splashBudget.get(car);
        if (!budgets) {
            budgets = SPLASH_EMITTERS.map(() => 0);
            this._splashBudget.set(car, budgets);
        }
        const at = new THREE.Vector3();
        const v = new THREE.Vector3();
        SPLASH_EMITTERS.forEach((e, i) => {
            const total = budgets[i] + ms / e.periodMs;
            const count = Math.floor(total);
            budgets[i] = total - count;
            for (let k = 0; k < count; k++) {
                ejectionDirection(v, e.thetaMin, e.thetaMax, e.phiVariance);
                at.copy(p).setZ(water.surfaceZ).addScaledVector(v, e.offset);
                v.multiplyScalar(e.speed + (Math.random() * 2 - 1) * e.speedVariance);
                v.addScaledVector(velocity, e.inherit);
                this.combat.particles.emit(e.look, at, v);
            }
        });
    }

    /**
     * Throws dust behind wheels that slip on the ground (`WheeledVehicle::updateWheelParticles`):
     * more dust the faster the car goes and the more the tire slips.
     */
    private _emitDust(car: Car, dt: number): void {
        const v = car.vehicle;
        const speed = v.speed;
        if (speed <= 1 || car.respawnTimer > 0) return;
        let budget = this._dustBudget.get(car) ?? 0;
        for (const w of v.wheels) {
            if (!w.contact || w.slip <= 0) continue;
            // Emitter time in ms for this frame, one particle per 10 ms of it.
            budget += (dt * (speed / v.data.maxWheelSpeed) * 1000 * w.slip) / DUST_PERIOD_MS;
            const count = Math.floor(budget);
            if (count > 0) {
                budget -= count;
                this.combat.particles.burst(
                    TIRE_DUST,
                    w.contactPoint,
                    count,
                    1,
                    1,
                    v.rigid.linVelocity.clone().multiplyScalar(0.1),
                );
            }
        }
        this._dustBudget.set(car, budget);
    }

    private _updateRespawn(car: Car): void {
        car.respawnTimer -= TICK_SECONDS;
        if (car.respawnTimer > 0) return;
        car.respawnTimer = 0;
        car.damage = 0;
        this._placeAtCheckpoint(car);
        car.view.object.visible = true;
        car.obstacle.enabled = true;
        this.bots.find((b) => b.car === car)?.respawned();
    }

    private _placeAtCheckpoint(car: Car): void {
        const racer = this.race.racers.find((r) => r.vehicle === car.vehicle);
        if (!racer) return;
        const cp = racer.lastCheckpoint;
        // Keep only the heading, so a car that crashed upside down comes back on its wheels.
        const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(cp.rotation);
        const yaw = Math.atan2(-forward.x, forward.y);
        const upright = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw);
        car.place(cp.position.clone().add(new THREE.Vector3(0, 0, 1)), upright);
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
        for (const car of this.cars) {
            // Water hurts while the car is in it (`setDamageDt`: 0.075 every 50 ms).
            if (car.vehicle.waterCoverage > 0 && car.respawnTimer <= 0) {
                car.applyDamage((WATER_DAMAGE * TICK_SECONDS) / WATER_DAMAGE_PERIOD, { kind: 'water', source: null });
            }
            if (car.isWrecked) this.wreck(car);
            if (car.respawnTimer > 0) this._updateRespawn(car);
        }

        this.player.tick(this.player.respawnTimer > 0 ? idleMove(true) : move);
        for (const bot of this.bots) {
            bot.autopilot.slow = this.zones.inSlowZone(bot.car.vehicle.rigid.worldCenterOfMass);
            const driving = racing && bot.car.respawnTimer <= 0;
            bot.car.tick(driving ? bot.nextMove() : idleMove());
        }
        this.zones.tick(this.cars);

        // Weapons work before the green light too; only the throttle waits for it.
        const triggers = new Map<Car, Triggers>([[this.player, this._input.triggers()]]);
        if (racing) {
            for (const bot of this.bots)
                triggers.set(bot.car, bot.triggers(TICK_SECONDS, this.cars, this.track.collision));
        }
        this.combat.tick(TICK_SECONDS, this.cars, triggers);
        this.hazards.tick(TICK_SECONDS, this.cars);

        this.pickups.tick(TICK_SECONDS, this.cars);
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
