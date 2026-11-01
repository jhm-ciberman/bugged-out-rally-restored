import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VehicleInput } from '../src/input/VehicleInput';

function keyEvent(type: 'keydown' | 'keyup', code: string): Event {
    return Object.assign(new Event(type, { cancelable: true }), { code, repeat: false });
}

describe('VehicleInput', () => {
    beforeEach(() => {
        vi.stubGlobal('window', new EventTarget());
        vi.stubGlobal('document', Object.assign(new EventTarget(), { pointerLockElement: null, hasFocus: () => true }));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('ignores the race keys while disabled, so menus keep Tab and E', () => {
        const input = new VehicleInput(new EventTarget() as HTMLElement);
        input.enabled = false;
        const tab = keyEvent('keydown', 'Tab');
        window.dispatchEvent(tab);
        window.dispatchEvent(keyEvent('keydown', 'KeyE'));
        expect(input.firstPerson).toBe(false);
        expect(input.fov).toBe(90);
        expect(tab.defaultPrevented).toBe(false);
    });

    it('forgets held keys when disabled', () => {
        const input = new VehicleInput(new EventTarget() as HTMLElement);
        window.dispatchEvent(keyEvent('keydown', 'KeyW'));
        input.enabled = false;
        expect(input.nextMove().throttle).toBe(0);
    });

    it('narrows the zoom with each Adjust Zoom press and wraps back to the widest', () => {
        const input = new VehicleInput(new EventTarget() as HTMLElement);
        const zoomed = () => {
            window.dispatchEvent(keyEvent('keydown', 'KeyE'));
            const fov = input.fov;
            window.dispatchEvent(keyEvent('keyup', 'KeyE'));
            return fov;
        };
        const seen = [zoomed()];
        for (let i = 0; i < 3; i++) {
            window.dispatchEvent(keyEvent('keydown', 'KeyR'));
            window.dispatchEvent(keyEvent('keyup', 'KeyR'));
            seen.push(zoomed());
        }
        expect(seen).toEqual([45, 22.5, 11.25, 45]);
    });
});
