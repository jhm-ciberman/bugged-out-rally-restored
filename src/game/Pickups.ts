import * as THREE from 'three';
import type { MissionObject } from '../torque/MissionFile';
import type { Car } from './Car';

/** Seconds an item stays gone after being picked up (`$Item::RespawnTime`). */
const RESPAWN_SECONDS = 20;
/** Most rockets and bombs a car can carry (`maxInv` in deathcar.cs). */
export const MAX_ROCKETS = 5;
export const MAX_BOMBS = 5;
/** Damage a cherry repairs (`HealthKit.repairAmount`). */
const REPAIR_AMOUNT = 25;
/** Extra reach around the car body when touching an item, in meters. */
const REACH = 1;

const _local = new THREE.Vector3();
const _inv = new THREE.Quaternion();

interface PickupItem {
    readonly kind: 'rocket' | 'bomb' | 'health';
    readonly model: THREE.Object3D;
    readonly position: THREE.Vector3;
    hiddenFor: number;
}

/**
 * Something a car picked up, for sounds and messages.
 */
export interface PickupEvent {
    readonly car: Car;
    readonly kind: PickupItem['kind'];
}

/**
 * The ammo boxes and cherries on the track (`item.cs`, `inventory.cs`, `health.cs`): a car that touches one
 * takes it if it has room, and the item comes back 20 seconds later.
 */
export class Pickups {
    private readonly _items: PickupItem[] = [];
    onPickup: ((event: PickupEvent) => void) | null = null;

    constructor(models: readonly THREE.Object3D[]) {
        for (const model of models) {
            const mission = model.userData.mission as MissionObject | undefined;
            const datablock = (mission?.fields.get('datablock') ?? '').toLowerCase();
            const kind =
                datablock === 'rocketammo'
                    ? 'rocket'
                    : datablock === 'bombammo'
                      ? 'bomb'
                      : datablock === 'healthkit'
                        ? 'health'
                        : null;
            if (kind) this._items.push({ kind, model, position: model.position.clone(), hiddenFor: 0 });
        }
    }

    /**
     * Respawns items and lets the cars collect the ones they touch. Call once per tick.
     */
    tick(dt: number, cars: readonly Car[]): void {
        for (const item of this._items) {
            if (item.hiddenFor > 0) {
                item.hiddenFor -= dt;
                if (item.hiddenFor <= 0) item.model.visible = true;
                continue;
            }
            for (const car of cars) {
                if (car.isWrecked || car.respawnTimer > 0 || !touches(car, item.position)) continue;
                if (this._take(car, item.kind)) {
                    item.hiddenFor = RESPAWN_SECONDS;
                    item.model.visible = false;
                    this.onPickup?.({ car, kind: item.kind });
                    break;
                }
            }
        }
    }

    private _take(car: Car, kind: PickupItem['kind']): boolean {
        switch (kind) {
            case 'rocket':
                if (car.rockets >= MAX_ROCKETS) return false;
                car.rockets++;
                return true;
            case 'bomb':
                if (car.bombs >= MAX_BOMBS) return false;
                car.bombs++;
                return true;
            case 'health':
                if (car.damage <= 0) return false;
                car.damage = Math.max(0, car.damage - REPAIR_AMOUNT);
                return true;
        }
    }
}

function touches(car: Car, point: THREE.Vector3): boolean {
    const rigid = car.vehicle.rigid;
    _local.copy(point).sub(rigid.linPosition).applyQuaternion(_inv.copy(rigid.angPosition).invert());
    const b = car.vehicle.data.bounds;
    return (
        _local.x > b.min.x - REACH &&
        _local.x < b.max.x + REACH &&
        _local.y > b.min.y - REACH &&
        _local.y < b.max.y + REACH &&
        _local.z > b.min.z - REACH &&
        _local.z < b.max.z + REACH
    );
}
