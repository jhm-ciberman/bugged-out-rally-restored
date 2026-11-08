import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateSettings } from '../src/game/Settings';
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

    it('holds an action by name while the player has cleared its binding', () => {
        updateSettings({ keyBindings: { throttle: null } });
        try {
            const input = new VehicleInput(new EventTarget() as HTMLElement);
            input.setActionHeld('throttle', true);
            expect(input.nextMove().throttle).toBe(1);
            input.setActionHeld('throttle', false);
            expect(input.nextMove().throttle).toBe(0);
        } finally {
            updateSettings({ keyBindings: {} });
        }
    });

    it('ignores held actions and reset requests while disabled', () => {
        const input = new VehicleInput(new EventTarget() as HTMLElement);
        input.enabled = false;
        input.setActionHeld('fire', true);
        input.requestReset();
        input.enabled = true;
        expect(input.triggers().fire).toBe(false);
        expect(input.consumeReset()).toBe(false);
    });

    it('forgets held actions when disabled', () => {
        const input = new VehicleInput(new EventTarget() as HTMLElement);
        input.setActionHeld('brake', true);
        input.enabled = false;
        input.enabled = true;
        expect(input.nextMove().brake).toBe(false);
    });

    it('survives a click when the browser has no pointer lock', () => {
        const input = new VehicleInput(new EventTarget() as HTMLElement);
        expect(() => (input as unknown as { _onClick(): void })._onClick()).not.toThrow();
    });

    it('swallows a refused pointer lock, also on the retry', async () => {
        const requestPointerLock = vi.fn(() => Promise.reject(new Error('refused')));
        const element = Object.assign(new EventTarget(), { requestPointerLock });
        new VehicleInput(element as unknown as HTMLElement);
        element.dispatchEvent(new Event('click'));
        await new Promise((resolve) => setTimeout(resolve));
        expect(requestPointerLock).toHaveBeenCalledTimes(2);
    });
});
