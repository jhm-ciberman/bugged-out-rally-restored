import { describe, expect, it } from 'vitest';
import { depthAlpha } from '../src/world/WaterSurface';

describe('depthAlpha', () => {
    const shore = { shoreDepth: 6, minAlpha: 0.1, maxAlpha: 1, depthGradient: 1 };

    it('is the minimum on dry land and at the waterline', () => {
        expect(depthAlpha(-2, shore)).toBeCloseTo(0.1);
        expect(depthAlpha(0, shore)).toBeCloseTo(0.1);
    });

    it('grows with depth up to the shore depth', () => {
        expect(depthAlpha(3, shore)).toBeCloseTo(0.55);
    });

    it('is the maximum past the shore depth', () => {
        expect(depthAlpha(40, shore)).toBeCloseTo(1);
    });

    it('bends the ramp with the gradient', () => {
        expect(depthAlpha(1.5, { ...shore, depthGradient: 0.5 })).toBeCloseTo(0.9 * 0.25 ** 2 + 0.1);
    });

    it('fades back out past the shore depth for the shore map', () => {
        expect(depthAlpha(6, shore, true)).toBeCloseTo(1 - 0.1);
        expect(depthAlpha(9, shore, true)).toBeCloseTo(1 - (0.9 * 0.5 + 0.1));
        expect(depthAlpha(40, shore, true)).toBeCloseTo(0);
        expect(depthAlpha(3, shore, true)).toBeCloseTo(0.55);
    });
});
