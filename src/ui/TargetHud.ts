import * as THREE from 'three';
import { assetUrl } from '../assets/AssetPaths';
import type { Car } from '../game/Car';
import type { RaceSession } from '../game/RaceSession';

/** Name tags sit this far above a car's origin (`verticalOffset` in PlayGui.gui). */
const NAME_HEIGHT = 0.2;
/** Name tags fade from this share of the visible distance on (`distanceFade`). */
const DISTANCE_FADE = 0.1;
/** `textColor` of the name tags. */
const NAME_COLOR = 'rgba(0, 255, 0, 0.63)';
/** Size and offset below the center of the target's health bar (`damageRect`, `damageOffset`). */
const BAR = { width: 50, height: 4, offsetY: 10 };

const _dir = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Names over the other cars (`GuiShapeNameHud`) and, in first person, the crosshair with the health of the car
 * it points at (`GuiCrossHairHud`).
 */
export class TargetHud {
    private readonly _crosshair = document.createElement('img');
    private readonly _bar = document.createElement('div');
    private readonly _barFill = document.createElement('div');
    private readonly _names: HTMLDivElement[] = [];
    private readonly _nameLayer = document.createElement('div');

    constructor(parent: HTMLElement) {
        Object.assign(this._nameLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
        this._crosshair.src = assetUrl('client/ui/crosshair.png');
        Object.assign(this._crosshair.style, {
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: '32px',
            height: '32px',
            transform: 'translate(-50%, -50%)',
            display: 'none',
        });
        // `damageFrameColor` orange, `damageFillColor` green.
        Object.assign(this._bar.style, {
            position: 'absolute',
            left: '50%',
            top: `calc(50% + ${BAR.offsetY}px)`,
            width: `${BAR.width}px`,
            height: `${BAR.height}px`,
            marginLeft: `${-BAR.width / 2}px`,
            boxSizing: 'border-box',
            border: '1px solid rgb(255, 153, 0)',
            display: 'none',
        });
        Object.assign(this._barFill.style, { height: '100%', background: 'rgb(0, 255, 0)' });
        this._bar.append(this._barFill);
        parent.append(this._nameLayer, this._crosshair, this._bar);
    }

    /**
     * Updates the tags and the crosshair for a frame drawn with `camera`.
     *
     * @param fov Horizontal field of view of `camera`, in degrees.
     */
    render(session: RaceSession, camera: THREE.Camera, fov: number, width: number, height: number): void {
        const visibleDistance = session.track.visibleDistance;
        const world = session.track.collision;
        const eye = camera.position;
        camera.getWorldDirection(_camDir);
        const player = session.player;
        let shown = 0;
        for (const car of session.cars) {
            if (car === player || car.respawnTimer > 0) continue;
            _to.copy(car.renderPosition).sub(eye);
            const distSq = _to.lengthSq();
            // The engine compares the squared distance with the visible distance, and the cosine of the angle
            // with half the field of view in radians, so tags only show for close cars near the middle.
            if (distSq === 0 || distSq > visibleDistance) continue;
            const dist = Math.sqrt(distSq);
            if (_dir.copy(_to).divideScalar(dist).dot(_camDir) < THREE.MathUtils.degToRad(fov) / 2) continue;
            if (world.castRay(eye, car.renderPosition)) continue;
            _p.copy(car.renderPosition)
                .setZ(car.renderPosition.z + NAME_HEIGHT)
                .project(camera);
            if (_p.z > 1) continue;
            const fadeDistance = visibleDistance * DISTANCE_FADE;
            const opacity = dist < fadeDistance ? 1 : 1 - (dist - fadeDistance) / (visibleDistance - fadeDistance);
            const tag = this._tag(shown++);
            tag.textContent = nameOf(session, car);
            tag.style.opacity = String(opacity);
            tag.style.left = `${((_p.x + 1) / 2) * width}px`;
            tag.style.top = `${((1 - _p.y) / 2) * height}px`;
        }
        for (let i = shown; i < this._names.length; i++) this._names[i].style.display = 'none';

        const firstPerson = session.firstPerson;
        this._crosshair.style.display = firstPerson ? '' : 'none';
        const target = firstPerson ? aimedCar(session, eye, _camDir, visibleDistance) : null;
        this._bar.style.display = target ? '' : 'none';
        if (target) this._barFill.style.width = `${target.health * 100}%`;
    }

    private _tag(index: number): HTMLDivElement {
        let tag = this._names[index];
        if (!tag) {
            tag = document.createElement('div');
            // GuiDefaultProfile: Arial 14. The text sits centered above the point.
            Object.assign(tag.style, {
                position: 'absolute',
                font: '14px Arial, sans-serif',
                color: NAME_COLOR,
                whiteSpace: 'nowrap',
                transform: 'translate(-50%, -100%)',
            });
            this._nameLayer.append(tag);
            this._names.push(tag);
        }
        tag.style.display = '';
        return tag;
    }
}

function nameOf(session: RaceSession, car: Car): string {
    return session.race.racers.find((r) => r.vehicle === car.vehicle)?.name ?? '';
}

/**
 * Returns the nearest other car on the line of sight from `eye` along `dir`, if nothing solid is in front of it.
 */
function aimedCar(session: RaceSession, eye: THREE.Vector3, dir: THREE.Vector3, reach: number): Car | null {
    const end = new THREE.Vector3().copy(eye).addScaledVector(dir, reach);
    const wall = session.track.collision.castRay(eye, end);
    let best: Car | null = null;
    let bestT = wall ? wall.t * reach : reach;
    const ray = new THREE.Ray(eye, dir);
    const sphere = new THREE.Sphere();
    const hit = new THREE.Vector3();
    for (const car of session.cars) {
        if (car === session.player || car.respawnTimer > 0) continue;
        car.vehicle.data.bounds.getBoundingSphere(sphere);
        sphere.center.applyQuaternion(car.renderRotation).add(car.renderPosition);
        if (!ray.intersectSphere(sphere, hit)) continue;
        const t = hit.distanceTo(eye);
        if (t < bestT) {
            bestT = t;
            best = car;
        }
    }
    return best;
}
