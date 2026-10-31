/** Seconds from mounting until the weapon can fire (state "Activate"). */
const ACTIVATE_SECONDS = 0.5;
/** Seconds in the "Fire" state. */
const FIRE_SECONDS = 0.1;
/** Seconds in the "Reload" state. */
const RELOAD_SECONDS = 0.1;
/** Seconds of the empty click (state "DryFire"). */
const DRY_FIRE_SECONDS = 1;

type State = 'activate' | 'ready' | 'fire' | 'reload' | 'noAmmo' | 'dryFire';

/**
 * The state machine of a mounted weapon (`RocketLauncherImage` / `BombLauncherImage` in weapons.cs):
 * holding the trigger fires every 0.2 s while there is ammo.
 */
export class WeaponImage {
    private _state: State = 'activate';
    private _timer = ACTIVATE_SECONDS;

    /**
     * Advances the weapon by `dt` seconds. Returns true when it fires this step.
     *
     * @param triggerDown Whether the fire button is held.
     * @param hasAmmo Whether there is ammo to fire.
     */
    tick(dt: number, triggerDown: boolean, hasAmmo: boolean): boolean {
        this._timer -= dt;
        switch (this._state) {
            case 'activate':
                if (this._timer <= 0) this._enter(hasAmmo ? 'ready' : 'noAmmo');
                return false;
            case 'ready':
                if (!hasAmmo) this._enter('noAmmo');
                else if (triggerDown) {
                    this._enter('fire', FIRE_SECONDS);
                    return true;
                }
                return false;
            case 'fire':
                if (this._timer <= 0) this._enter('reload', RELOAD_SECONDS);
                return false;
            case 'reload':
                if (this._timer <= 0) this._enter(hasAmmo ? 'ready' : 'noAmmo');
                return false;
            case 'noAmmo':
                if (hasAmmo) this._enter('reload', RELOAD_SECONDS);
                else if (triggerDown) this._enter('dryFire', DRY_FIRE_SECONDS);
                return false;
            case 'dryFire':
                if (this._timer <= 0) this._enter('noAmmo');
                return false;
        }
    }

    private _enter(state: State, seconds = 0): void {
        this._state = state;
        this._timer = seconds;
    }
}
