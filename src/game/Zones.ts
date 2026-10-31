import * as THREE from 'three';
import { BoxObstacle, type Contact } from '../physics/CollisionWorld';
import { parseRotation, parseVector } from '../torque/TorqueMath';
import type { Track } from '../world/Track';
import { TriggerVolume } from '../world/TriggerVolume';
import type { Car } from './Car';

/** Push of a boost pad, as momentum (`BoostPadTrigger::onEnterTrigger`). */
const BOOST_IMPULSE = 2000;
/** Damage of a death zone; more than any car can take (`DeathZoneTrigger`). */
const DEATH_DAMAGE = 1000;

const _r = new THREE.Vector3();
const _point = new THREE.Vector3();
const _hits: Contact[] = [];
/** Collision box of `cactus.dts` (its collision-1 mesh), in shape space. */
const CACTUS_BOX = new THREE.Box3(new THREE.Vector3(-4, -3.5, -0.1), new THREE.Vector3(4, 3.5, 16.8));
/** Distance beyond which a cactus cannot touch a car. */
const CACTUS_REACH = 30;

/**
 * The trigger zones that act on cars: boost pads, death zones and the slow zones that hold bots back,
 * plus the cacti that wreck any car that touches them (`boostpad.cs`, `checkpoint.cs`, `flagpole.cs`).
 */
export class Zones {
    private readonly _boost: TriggerVolume[] = [];
    private readonly _death: TriggerVolume[] = [];
    private readonly _slow: TriggerVolume[] = [];
    private readonly _inside = new Map<Car, Set<TriggerVolume>>();
    private readonly _cacti: BoxObstacle[] = [];

    constructor(track: Track) {
        for (const o of track.objects) {
            if (o.className !== 'Trigger') continue;
            const datablock = (o.fields.get('datablock') ?? '').toLowerCase();
            if (datablock === 'boostpadtrigger') this._boost.push(new TriggerVolume(o));
            else if (datablock === 'deathzonetrigger') this._death.push(new TriggerVolume(o));
            else if (datablock === 'slowzonetrigger') this._slow.push(new TriggerVolume(o));
        }
        for (const o of track.objects) {
            if (o.className !== 'StaticShape' || (o.fields.get('datablock') ?? '').toLowerCase() !== 'cactus') continue;
            const scale = parseVector(o.fields.get('scale'), 1);
            const box = CACTUS_BOX.clone();
            box.min.multiply(scale);
            box.max.multiply(scale);
            const cactus = new BoxObstacle(o, box);
            cactus.position.copy(parseVector(o.fields.get('position')));
            cactus.rotation.copy(parseRotation(o.fields.get('rotation')));
            this._cacti.push(cactus);
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
            if (this._cacti.length > 0 && this._touchesCactus(car)) car.applyDamage(DEATH_DAMAGE);
        }
    }

    /**
     * Whether `point` is inside a slow zone.
     */
    inSlowZone(point: THREE.Vector3): boolean {
        return this._slow.some((z) => z.contains(point));
    }

    private _touchesCactus(car: Car): boolean {
        const rigid = car.vehicle.rigid;
        _hits.length = 0;
        for (const cactus of this._cacti) {
            if (cactus.position.distanceToSquared(rigid.linPosition) > CACTUS_REACH * CACTUS_REACH) continue;
            for (const p of car.vehicle.data.collisionHull) {
                cactus.contact(_point.copy(p).applyQuaternion(rigid.angPosition).add(rigid.linPosition), 0.1, _hits);
                if (_hits.length > 0) return true;
            }
        }
        return false;
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
