import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Bot, scanItems, scanTargets } from '../src/ai/Bot';
import type { Car } from '../src/game/Car';
import type { Racer } from '../src/game/Race';
import type { Track } from '../src/world/Track';

const origin = new THREE.Vector3(0, 0, 0);
const forward = new THREE.Vector3(0, 1, 0);

describe('scanTargets', () => {
    it('sees a car ahead up to 500 m, with no line of sight test', () => {
        expect(scanTargets(origin, forward, [new THREE.Vector3(0, 450, 0)]).ahead).toBe(true);
        expect(scanTargets(origin, forward, [new THREE.Vector3(0, 550, 0)]).ahead).toBe(false);
    });

    it('takes a 0.7 cosine cone ahead, in 3D', () => {
        // 40 degrees off the nose is inside, 50 is outside; straight above is outside.
        const at = (deg: number) =>
            new THREE.Vector3(
                Math.sin(THREE.MathUtils.degToRad(deg)),
                Math.cos(THREE.MathUtils.degToRad(deg)),
                0,
            ).multiplyScalar(100);
        expect(scanTargets(origin, forward, [at(40)]).ahead).toBe(true);
        expect(scanTargets(origin, forward, [at(50)]).ahead).toBe(false);
        expect(scanTargets(origin, forward, [new THREE.Vector3(0, 10, 100)]).ahead).toBe(false);
    });

    it('sees a car anywhere behind up to 1000 m', () => {
        expect(scanTargets(origin, forward, [new THREE.Vector3(300, -10, 0)]).behind).toBe(true);
        expect(scanTargets(origin, forward, [new THREE.Vector3(0, -900, 0)]).behind).toBe(true);
        expect(scanTargets(origin, forward, [new THREE.Vector3(0, -1100, 0)]).behind).toBe(false);
        // To the side (in neither test).
        expect(scanTargets(origin, forward, [new THREE.Vector3(100, 10, 0)])).toEqual({ ahead: false, behind: false });
    });

    it('stops at the first car ahead, so cars after it do not count as behind', () => {
        const ahead = new THREE.Vector3(0, 100, 0);
        const behind = new THREE.Vector3(0, -100, 0);
        expect(scanTargets(origin, forward, [ahead, behind])).toEqual({ ahead: true, behind: false });
        expect(scanTargets(origin, forward, [behind, ahead])).toEqual({ ahead: true, behind: true });
    });
});

describe('scanItems', () => {
    it('returns the first item in a 0.9 cosine cone within 1 to 100 m', () => {
        const near = new THREE.Vector3(0, 50, 0);
        const far = new THREE.Vector3(0, 150, 0);
        const wide = new THREE.Vector3(40, 50, 0);
        expect(scanItems(origin, forward, [far, wide, near])).toBe(near);
        expect(scanItems(origin, forward, [far, wide])).toBeNull();
    });
});

/** A bot on an empty track at the origin, facing +Y. */
function botAt(position: THREE.Vector3): Bot {
    const car = {
        vehicle: { rigid: { linPosition: position, angPosition: new THREE.Quaternion() } },
        respawnTimer: 0,
    } as unknown as Car;
    return new Bot(car, {} as Racer, { objects: [] } as unknown as Track, 0);
}

describe('Bot.triggers', () => {
    it('fires when a car comes into view ahead, then once a full second later', () => {
        const bot = botAt(new THREE.Vector3());
        const target = {
            vehicle: { rigid: { linPosition: new THREE.Vector3(0, 100, 0) } },
            respawnTimer: 0,
        } as unknown as Car;
        const shots: number[] = [];
        for (let tick = 0; tick < 100; tick++) {
            if (bot.triggers(0.032, [target], []).fire) shots.push(tick);
        }
        expect(shots.length).toBeGreaterThanOrEqual(2);
        expect((shots[1] - shots[0]) * 0.032).toBeGreaterThanOrEqual(1);
    });
});
