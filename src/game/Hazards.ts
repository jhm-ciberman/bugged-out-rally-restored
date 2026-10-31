import * as THREE from 'three';
import type { ModelLibrary } from '../assets/ModelLibrary';
import type { AudioSystem } from '../audio/AudioSystem';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { BOULDER, DynamicShape, type DynamicShapeData, SNOWBALL } from '../physics/DynamicShape';
import type { MissionObject } from '../torque/MissionFile';
import { parseRotation, parseVector } from '../torque/TorqueMath';
import type { Combat } from '../weapons/Combat';
import { SPIT } from '../weapons/Projectile';
import type { Track } from '../world/Track';
import { TriggerVolume } from '../world/TriggerVolume';
import type { Car } from './Car';

/** Seconds between rolls while a car is in a boulder or snow zone (`BoulderTask`, `SnowTask`). */
const ROLL_INTERVAL = 6;
/** Push given to a new boulder or snowball along the shooter's forward axis (`initialVelocity = 200`). */
const ROLL_MOMENTUM = 200;
/** Seconds between spits while a car is in a frog zone (`FrogZoneTrigger::FrogSpitTask`). */
const SPIT_INTERVAL = 1.5;
/** Seconds from the start of the spit animation to the shot (`frogBlock::startspit`). */
const SPIT_DELAY = 0.55;

interface FrogZone {
    readonly trigger: TriggerVolume;
    /** The frogs this zone wakes, by mission name. */
    readonly frogs: readonly MissionObject[];
    /** Seconds until the next spit while a car is inside, or null when idle. */
    timer: number | null;
}

interface RollZone {
    readonly trigger: TriggerVolume;
    readonly shooters: readonly MissionObject[];
    readonly ball: DynamicShapeData;
    timer: number | null;
}

interface Rolling {
    readonly shape: DynamicShape;
    model: THREE.Object3D | null;
}

interface PendingShot {
    readonly frog: MissionObject;
    delay: number;
}

/**
 * The track hazards: frogs that spit at cars, and boulders and snowballs that roll down onto the track
 * while cars are near (`FrogZoneTrigger`, `BoulderZoneTrigger`, `SnowZoneTrigger` in checkpoint.cs; dynShape.cs).
 */
export class Hazards {
    private readonly _frogZones: FrogZone[] = [];
    private readonly _shots: PendingShot[] = [];
    private readonly _rollZones: RollZone[] = [];
    private readonly _rolling: Rolling[] = [];

    private readonly _world: CollisionWorld;

    constructor(
        track: Track,
        private readonly _combat: Combat,
        private readonly _models: ModelLibrary,
        private readonly _audio: AudioSystem | null,
    ) {
        this._world = track.collision;
        const frog = (name: string) => track.find(name);
        for (const o of track.objects) {
            if (o.className !== 'Trigger' || (o.fields.get('datablock') ?? '').toLowerCase() !== 'frogzonetrigger')
                continue;
            // spitzone1 wakes Frog1 and Frog2; any other zone wakes Frog3.
            const names = o.name.toLowerCase() === 'spitzone1' ? ['Frog1', 'Frog2'] : ['Frog3'];
            const frogs = names.map(frog).filter((f): f is MissionObject => f !== undefined);
            this._frogZones.push({ trigger: new TriggerVolume(o), frogs, timer: null });
        }
        // boulderzone1 wakes Bshooter1-2, boulderzone2 Bshooter3-4; the snow zones work the same way.
        const rollZones: Record<string, [string[], DynamicShapeData]> = {
            boulderzone1: [['Bshooter1', 'Bshooter2'], BOULDER],
            boulderzone2: [['Bshooter3', 'Bshooter4'], BOULDER],
            snowzone1: [['Snowshooter1', 'Snowshooter2'], SNOWBALL],
            snowzone2: [['Snowshooter3', 'Snowshooter4'], SNOWBALL],
        };
        for (const o of track.objects) {
            const datablock = (o.fields.get('datablock') ?? '').toLowerCase();
            if (o.className !== 'Trigger' || (datablock !== 'boulderzonetrigger' && datablock !== 'snowzonetrigger'))
                continue;
            const entry = rollZones[o.name.toLowerCase()];
            if (!entry) continue;
            const shooters = entry[0].map(frog).filter((f): f is MissionObject => f !== undefined);
            this._rollZones.push({ trigger: new TriggerVolume(o), shooters, ball: entry[1], timer: null });
        }
        _audio?.preload('SpitFireSound');
    }

    /**
     * Draws the rolling objects where they are now.
     */
    update(): void {
        for (const r of this._rolling) {
            if (!r.model) continue;
            r.model.position.copy(r.shape.rigid.linPosition);
            r.model.quaternion.copy(r.shape.rigid.angPosition);
        }
    }

    /**
     * Runs the zones and the frogs for one tick.
     */
    tick(dt: number, cars: readonly Car[]): void {
        for (const zone of this._frogZones) {
            const occupied = cars.some(
                (c) => c.respawnTimer <= 0 && zone.trigger.contains(c.vehicle.rigid.worldCenterOfMass),
            );
            if (!occupied) {
                zone.timer = null;
                continue;
            }
            // The first car in starts the task at once; it repeats while anyone is inside.
            zone.timer = zone.timer === null ? 0 : zone.timer - dt;
            if (zone.timer <= 0) {
                zone.timer = SPIT_INTERVAL;
                for (const frog of zone.frogs) this._shots.push({ frog, delay: SPIT_DELAY });
            }
        }

        for (const zone of this._rollZones) {
            // Boulders and snowballs in the zone do not keep it awake.
            const occupied = cars.some(
                (c) => c.respawnTimer <= 0 && zone.trigger.contains(c.vehicle.rigid.worldCenterOfMass),
            );
            if (!occupied) {
                zone.timer = null;
                continue;
            }
            zone.timer = zone.timer === null ? 0 : zone.timer - dt;
            if (zone.timer <= 0) {
                zone.timer = ROLL_INTERVAL;
                for (const shooter of zone.shooters) this._roll(shooter, zone.ball);
            }
        }

        for (let i = this._rolling.length - 1; i >= 0; i--) {
            const r = this._rolling[i];
            r.shape.tick(dt);
            if (r.shape.expired) {
                this._rolling.splice(i, 1);
                r.model?.removeFromParent();
                const obstacles = this._world.obstacles;
                obstacles.splice(obstacles.indexOf(r.shape.obstacle), 1);
            }
        }

        for (let i = this._shots.length - 1; i >= 0; i--) {
            const shot = this._shots[i];
            shot.delay -= dt;
            if (shot.delay > 0) continue;
            this._shots.splice(i, 1);
            this._spit(shot.frog);
        }
    }

    /**
     * Starts a boulder or snowball at a shooter (`BoulderLauncherImage::onFire`).
     *
     * The script asks for an initial velocity of 200, which the native class seems to take as momentum:
     * the shooters sit up the hills and the balls roll down onto the track.
     */
    private _roll(shooter: MissionObject, data: DynamicShapeData): void {
        const position = parseVector(shooter.fields.get('position'));
        const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(parseRotation(shooter.fields.get('rotation')));
        const shape = new DynamicShape(data, this._world, position, forward.multiplyScalar(ROLL_MOMENTUM));
        this._world.obstacles.push(shape.obstacle);
        const rolling: Rolling = { shape, model: null };
        this._rolling.push(rolling);
        void this._models.instantiate(data.shapeFile).then((model) => {
            if (!model || !this._rolling.includes(rolling)) return;
            rolling.model = model;
            this._combat.object.add(model);
        });
    }

    private _spit(frog: MissionObject): void {
        // The frog has no mount node, so the shot leaves from its origin along its forward axis.
        const position = parseVector(frog.fields.get('position'));
        const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(parseRotation(frog.fields.get('rotation')));
        this._combat.launch(SPIT, null, position, forward.multiplyScalar(SPIT.muzzleVelocity));
        if (this._audio) void this._audio.play3d('SpitFireSound', position, this._combat.object);
    }
}
