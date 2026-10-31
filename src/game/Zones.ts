import * as THREE from 'three';
import type { Track } from '../world/Track';
import { TriggerVolume } from '../world/TriggerVolume';
import type { Car } from './Car';

/** Push of a boost pad, as momentum (`BoostPadTrigger::onEnterTrigger`). */
const BOOST_IMPULSE = 2000;
/** Damage of a death zone; more than any car can take (`DeathZoneTrigger`). */
const DEATH_DAMAGE = 1000;

const _r = new THREE.Vector3();

/**
 * The trigger zones that act on cars: boost pads, death zones and the slow zones that hold bots back
 * (`boostpad.cs`, `checkpoint.cs`).
 */
export class Zones {
    private readonly _boost: TriggerVolume[] = [];
    private readonly _death: TriggerVolume[] = [];
    private readonly _slow: TriggerVolume[] = [];
    private readonly _inside = new Map<Car, Set<TriggerVolume>>();

    constructor(track: Track) {
        for (const o of track.objects) {
            if (o.className !== 'Trigger') continue;
            const datablock = (o.fields.get('datablock') ?? '').toLowerCase();
            if (datablock === 'boostpadtrigger') this._boost.push(new TriggerVolume(o));
            else if (datablock === 'deathzonetrigger') this._death.push(new TriggerVolume(o));
            else if (datablock === 'slowzonetrigger') this._slow.push(new TriggerVolume(o));
        }
    }

    /**
     * Applies enter effects for every car. Call once per tick.
     */
    tick(cars: readonly Car[]): void {
        for (const car of cars) {
            if (car.isWrecked || car.respawnTimer > 0) continue;
            const p = car.vehicle.rigid.worldCenterOfMass;
            let inside = this._inside.get(car);
            if (!inside) {
                inside = new Set();
                this._inside.set(car, inside);
            }
            for (const zone of this._boost) {
                if (this._entered(inside, zone, p)) this._boostCar(car, zone);
            }
            for (const zone of this._death) {
                if (this._entered(inside, zone, p)) car.applyDamage(DEATH_DAMAGE);
            }
        }
    }

    /**
     * Whether `point` is inside a slow zone.
     */
    inSlowZone(point: THREE.Vector3): boolean {
        return this._slow.some((z) => z.contains(point));
    }

    private _entered(inside: Set<TriggerVolume>, zone: TriggerVolume, p: THREE.Vector3): boolean {
        if (zone.contains(p)) {
            if (inside.has(zone)) return false;
            inside.add(zone);
            return true;
        }
        inside.delete(zone);
        return false;
    }

    private _boostCar(car: Car, zone: TriggerVolume): void {
        // Impulse along the trigger's forward axis, at the car's origin.
        const rigid = car.vehicle.rigid;
        rigid.getOriginVector(rigid.linPosition, _r);
        rigid.applyImpulse(_r, zone.forward.clone().multiplyScalar(BOOST_IMPULSE));
        car.startBoost();
    }
}
