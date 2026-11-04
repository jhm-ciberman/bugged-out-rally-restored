import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { EXPLOSION_FIRE, EXPLOSION_SMOKE, Particles } from '../src/render/Particles';

vi.mock('../src/assets/AssetPaths', () => ({ resolveTorqueFile: () => null }));

describe('Particles', () => {
    it('lets a timed burst out over its seconds, not all at once', () => {
        const particles = new Particles();
        particles.burst(EXPLOSION_SMOKE, new THREE.Vector3(), 25, 4, 0.5, undefined, { seconds: 0.25 });
        expect(particles.count).toBe(0);
        particles.update(0.1);
        expect(particles.count).toBe(10);
        particles.update(0.2);
        expect(particles.count).toBe(25);
        particles.update(0.2);
        expect(particles.count).toBe(25);
    });

    it('loads the looks it is told to preload before any particle uses them', () => {
        const particles = new Particles();
        particles.preload([EXPLOSION_FIRE, EXPLOSION_SMOKE]);
        expect(particles.object.children).toHaveLength(2);
        expect(particles.count).toBe(0);
    });

    it('draws glowing particles after see-through ones', () => {
        const particles = new Particles();
        particles.burst(EXPLOSION_FIRE, new THREE.Vector3(), 1, 1);
        particles.burst(EXPLOSION_SMOKE, new THREE.Vector3(), 1, 1);
        const [fire, smoke] = particles.object.children;
        expect(fire.renderOrder).toBeGreaterThan(smoke.renderOrder);
    });
});
