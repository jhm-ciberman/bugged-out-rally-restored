import * as THREE from 'three';
import type { AudioSystem } from '../audio/AudioSystem';
import type { MissionObject } from '../torque/MissionFile';
import { parseRotation, parseVector } from '../torque/TorqueMath';
import type { Combat } from '../weapons/Combat';
import { SPIT } from '../weapons/Projectile';
import type { Track } from '../world/Track';
import { TriggerVolume } from '../world/TriggerVolume';
import type { Car } from './Car';

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

interface PendingShot {
    readonly frog: MissionObject;
    delay: number;
}

/**
 * The track creatures that attack cars: frogs on Croaky Pond spit at cars in their zones
 * (`FrogZoneTrigger` in checkpoint.cs, `frogBlock` in dynShape.cs).
 */
export class Hazards {
    private readonly _frogZones: FrogZone[] = [];
    private readonly _shots: PendingShot[] = [];

    constructor(
        track: Track,
        private readonly _combat: Combat,
        private readonly _audio: AudioSystem | null,
    ) {
        const frog = (name: string) => track.find(name);
        for (const o of track.objects) {
            if (o.className !== 'Trigger' || (o.fields.get('datablock') ?? '').toLowerCase() !== 'frogzonetrigger')
                continue;
            // spitzone1 wakes Frog1 and Frog2; any other zone wakes Frog3.
            const names = o.name.toLowerCase() === 'spitzone1' ? ['Frog1', 'Frog2'] : ['Frog3'];
            const frogs = names.map(frog).filter((f): f is MissionObject => f !== undefined);
            this._frogZones.push({ trigger: new TriggerVolume(o), frogs, timer: null });
        }
        _audio?.preload('SpitFireSound');
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

        for (let i = this._shots.length - 1; i >= 0; i--) {
            const shot = this._shots[i];
            shot.delay -= dt;
            if (shot.delay > 0) continue;
            this._shots.splice(i, 1);
            this._spit(shot.frog);
        }
    }

    private _spit(frog: MissionObject): void {
        // The frog has no mount node, so the shot leaves from its origin along its forward axis.
        const position = parseVector(frog.fields.get('position'));
        const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(parseRotation(frog.fields.get('rotation')));
        this._combat.launch(SPIT, null, position, forward.multiplyScalar(SPIT.muzzleVelocity));
        if (this._audio) void this._audio.play3d('SpitFireSound', position, this._combat.object);
    }
}
