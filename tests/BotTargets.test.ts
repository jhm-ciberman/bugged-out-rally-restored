import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { scanTargets } from '../src/ai/Bot';

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
});
