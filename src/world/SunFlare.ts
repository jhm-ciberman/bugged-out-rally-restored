import * as THREE from 'three';
import { resolveTorqueFile } from '../assets/AssetPaths';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { MissionObject } from '../torque/MissionFile';
import { parseColor } from '../torque/TorqueMath';

/**
 * Billboard radius as a share of the distance to it. The engine sizes it to the screen
 * (`distance / (viewport width / 640) / 2`); this keeps the size it had at 800x600.
 */
const RADIUS_PER_DISTANCE = 320 / 800;

const loader = new THREE.TextureLoader();

/**
 * One animated value of a flare: a key string such as `"AZA"`, played over `seconds`, where `A` is the
 * minimum and `Z` the maximum (`fxSunLight::AnimateSun`, `GetLerpKey`).
 */
class Channel {
    private _elapsed = 0;

    constructor(
        private readonly _keys: string,
        private readonly _seconds: number,
        private readonly _min: number,
        private readonly _max: number,
        private readonly _lerp: boolean,
    ) {}

    /**
     * Advances the animation by `dt` seconds and returns the current value.
     */
    advance(dt: number): number {
        const keys = this._keys.toUpperCase();
        if (keys.length === 0 || this._seconds <= 0) return this._min;
        this._elapsed += dt;
        while (this._elapsed > this._seconds) this._elapsed -= this._seconds;
        const scaled = this._elapsed * ((keys.length - 1) / this._seconds);
        const from = Math.min(Math.floor(scaled), keys.length - 1);
        const to = this._lerp ? Math.min(Math.ceil(scaled), keys.length - 1) : from;
        const lerp = this._lerp ? scaled - from : 0;
        const a = keys.charCodeAt(from) - 65;
        const b = keys.charCodeAt(to) - 65;
        return this._min + (a + (b - a) * lerp) * ((this._max - this._min) / 25);
    }
}

/**
 * A lens flare over the sun (`fxSunLight`): an animated glow drawn twice, once behind the scenery
 * and once on top of it while the sun is in sight.
 */
export class SunFlare {
    readonly object = Object.assign(new THREE.Group(), { name: 'SunFlare' });
    private readonly _behind: THREE.Sprite;
    private readonly _onTop: THREE.Sprite;
    private readonly _color: THREE.Color;
    private readonly _brightness: Channel | null;
    private readonly _rotation: Channel | null;
    private readonly _size: Channel | null;
    private readonly _baseBrightness: number;
    private readonly _baseSize: number;
    private readonly _fadeTime: number;
    private readonly _thirdPerson: boolean;
    /** How far the on-top flare is shown, 0 to 1 (`mLocalFlareScale`). */
    private _fade = 0;
    private readonly _sunPosition = new THREE.Vector3();

    constructor(
        obj: MissionObject,
        /** Unit vector toward the sun; the flare follows the mission's sun (`LockToRealSun`). */
        private readonly _toSun: THREE.Vector3,
        /** Distance the flare is drawn at, just inside the visible distance. */
        private readonly _distance: number,
        private readonly _world: CollisionWorld,
    ) {
        const f = (name: string, fallback: number) => Number(obj.fields.get(name) ?? fallback);
        const on = (name: string, fallback: boolean) => (obj.fields.get(name) ?? (fallback ? '1' : '0')) === '1';
        const s = (name: string, fallback: string) => obj.fields.get(name) ?? fallback;
        this._color = parseColor(s('colour', '1 1 1'));
        this._baseBrightness = f('brightness', 1);
        this._baseSize = f('flaresize', 1);
        this._fadeTime = Math.max(f('fadetime', 0.1), 1e-3);
        this._thirdPerson = on('flaretp', true);
        this._brightness = on('animbrightness', false)
            ? new Channel(
                  s('brightnesskeys', 'AZA'),
                  f('brightnesstime', 5),
                  f('minbrightness', 0),
                  f('maxbrightness', 1),
                  on('lerpbrightness', true),
              )
            : null;
        this._rotation = on('animrotation', false)
            ? new Channel(
                  s('rotationkeys', 'AZA'),
                  f('rotationtime', 5),
                  f('minrotation', 0),
                  f('maxrotation', 359),
                  on('lerprotation', true),
              )
            : null;
        this._size = on('animsize', false)
            ? new Channel(
                  s('sizekeys', 'AZA'),
                  f('sizetime', 5),
                  f('minsize', 0.5),
                  f('maxsize', 1),
                  on('lerpsize', true),
              )
            : null;

        const sprite = (texture: string, onTop: boolean) => {
            const url = resolveTorqueFile(`~/${texture}`) ?? resolveTorqueFile(texture);
            const map = url ? loader.load(url) : null;
            if (map) map.colorSpace = THREE.NoColorSpace;
            // Blend mode 0: the texture is added to the scene.
            const material = new THREE.SpriteMaterial({
                map,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                depthTest: !onTop,
                fog: false,
                transparent: true,
            });
            const s = new THREE.Sprite(material);
            s.renderOrder = onTop ? 1000 : 0;
            s.frustumCulled = false;
            this.object.add(s);
            return s;
        };
        this._behind = sprite(s('remoteflarebitmap', 'common/lighting/corona'), false);
        this._onTop = sprite(s('localflarebitmap', 'common/lighting/corona'), true);
        this.object.visible = on('enable', true);
    }

    /**
     * Animates the flare and places it toward the sun as seen from `camera`.
     */
    update(dt: number, camera: THREE.Camera): void {
        const brightness = this._brightness?.advance(dt) ?? this._baseBrightness;
        const rotation = this._rotation?.advance(dt) ?? 0;
        const size = this._size?.advance(dt) ?? this._baseSize;

        const eye = camera.position;
        this._sunPosition.copy(eye).addScaledVector(this._toSun, this._distance);
        // The engine sees the sun when nothing solid is between the camera and it.
        const inSight = this._thirdPerson && this._world.castRay(eye, this._sunPosition) === null;
        this._fade = THREE.MathUtils.clamp(this._fade + (inSight ? dt : -dt) / this._fadeTime, 0, 1);

        // Fixed-function colors clamp to 1 after the brightness scales them.
        const color = new THREE.Color(
            Math.min(this._color.r * brightness, 1),
            Math.min(this._color.g * brightness, 1),
            Math.min(this._color.b * brightness, 1),
        );
        const radius = this._distance * RADIUS_PER_DISTANCE * size;
        for (const [sprite, scale] of [
            [this._behind, 1],
            [this._onTop, this._fade],
        ] as const) {
            sprite.position.copy(this._sunPosition);
            sprite.scale.setScalar(radius * 2 * scale);
            sprite.visible = scale > 0;
            sprite.material.color.copy(color);
            sprite.material.rotation = THREE.MathUtils.degToRad(rotation);
        }
    }
}
