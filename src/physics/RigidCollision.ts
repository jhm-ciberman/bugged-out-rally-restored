import * as THREE from 'three';
import type { Contact } from './CollisionWorld';
import type { Rigid } from './Rigid';

/** Most impulse passes per step, a safety net for the engine's open-ended loop. */
const MAX_COLLISION_PASSES = 16;

const _r = new THREE.Vector3();
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _t = new THREE.Vector3();

/**
 * Applies collision impulses for the contacts the body is moving into faster than `contactTol`
 * (`Vehicle::resolveCollision`). Returns whether any impulse was applied.
 */
export function resolveCollisions(
    rigid: Rigid,
    contacts: readonly Contact[],
    tol: number,
    contactTol: number,
): boolean {
    let collided = false;
    for (let pass = 0; pass < MAX_COLLISION_PASSES; pass++) {
        let colliding = false;
        for (const c of contacts) {
            if (c.distance >= tol) continue;
            rigid.getOriginVector(c.point, _r);
            rigid.getVelocity(_r, _v);
            if (_v.dot(c.normal) < -contactTol) {
                rigid.resolveCollision(c.point, c.normal);
                colliding = collided = true;
            }
        }
        if (!colliding) break;
    }
    return collided;
}

/**
 * Applies penalty forces for resting contacts: a spring that pushes the body out, plus friction
 * (`Vehicle::resolveContacts`).
 */
export function resolveContacts(
    rigid: Rigid,
    contacts: readonly Contact[],
    tol: number,
    contactTol: number,
    dt: number,
): void {
    const p = new THREE.Vector3();
    const l = new THREE.Vector3();
    for (const c of contacts) {
        if (c.distance >= tol) continue;
        rigid.getOriginVector(c.point, _r);
        rigid.getVelocity(_r, _v);
        const vn = _v.dot(c.normal);
        if (Math.abs(vn) >= contactTol) continue;

        const zi = 2 * Math.abs(rigid.getZeroImpulse(_r, c.normal));
        let s = (tol - c.distance) * zi - (vn / contactTol) * zi;
        _f.copy(c.normal).multiplyScalar(s);

        const uv = _v.addScaledVector(c.normal, -vn);
        const ul = uv.length();
        if (s > 0 && ul) {
            uv.divideScalar(-ul);
            let u = ul * rigid.getZeroImpulse(_r, uv);
            s *= rigid.friction;
            if (u > s) u = s;
            _f.addScaledVector(uv, u);
        }
        p.add(_f);
        l.add(_t.crossVectors(_r, _f));
    }
    rigid.linMomentum.addScaledVector(p, dt);
    rigid.angMomentum.addScaledVector(l, dt);
    rigid.updateVelocity();
}
