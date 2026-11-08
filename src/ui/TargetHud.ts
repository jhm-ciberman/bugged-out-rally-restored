import * as THREE from 'three';
import { assetUrl } from '../assets/AssetPaths';
import type { Car } from '../game/Car';
import type { RaceSession } from '../game/RaceSession';
import { arialFont, guiPx } from './GuiControls';

/** Name tags sit this far above a car's origin (`verticalOffset` in PlayGui.gui). */
const NAME_HEIGHT = 0.2;
/** Name tags fade from this share of the visible distance on (`distanceFade`). */
const DISTANCE_FADE = 0.1;
/** `textColor` of the name tags. */
const NAME_COLOR = 'rgba(0, 255, 0, 0.63)';
/** Size and offset below the center of the target's health bar (`damageRect`, `damageOffset`). */
const BAR = { width: 50, height: 4, offsetY: 10 };

/** Health bar over a name tag (`damageRect = "30 4"`, `damageOffset = "0 -20"`). */
const NAME_BAR = { width: 30, height: 4, offsetY: -20 };

interface NameTag {
    readonly root: HTMLDivElement;
    readonly name: HTMLDivElement;
    readonly fill: HTMLDivElement;
}

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
    private readonly _names: NameTag[] = [];
    private readonly _nameLayer = document.createElement('div');

    constructor(parent: HTMLElement) {
        Object.assign(this._nameLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
        this._crosshair.src = assetUrl('client/ui/crosshair.png');
        Object.assign(this._crosshair.style, {
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: guiPx(32),
            height: guiPx(32),
            transform: 'translate(-50%, -50%)',
            display: 'none',
        });
        // `damageFrameColor` orange, `damageFillColor` green.
        Object.assign(this._bar.style, {
            position: 'absolute',
            left: '50%',
            top: `calc(50% + ${guiPx(BAR.offsetY)})`,
            width: guiPx(BAR.width),
            height: guiPx(BAR.height),
            marginLeft: guiPx(-BAR.width / 2),
            boxSizing: 'border-box',
            border: `${guiPx(1)} solid rgb(255, 153, 0)`,
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
            // The control object has no tag; with the fly camera that is the camera, so the player's car gets one.
            if ((car === player && !session.freeCamera) || car.respawnTimer > 0) continue;
            _to.copy(car.renderPosition).sub(eye);
            const dist = _to.length();
            // Seen in the original: tags show out to the visible distance. The view cone compares the cosine
            // of the angle with half the field of view in radians (`GuiShapeNameHud::onRender`).
            if (dist === 0 || dist > visibleDistance) continue;
            if (_dir.copy(_to).divideScalar(dist).dot(_camDir) < THREE.MathUtils.degToRad(fov) / 2) continue;
            if (world.castRay(eye, car.renderPosition)) continue;
            _p.copy(car.renderPosition)
                .setZ(car.renderPosition.z + NAME_HEIGHT)
                .project(camera);
            if (_p.z > 1) continue;
            const fadeDistance = visibleDistance * DISTANCE_FADE;
            const opacity = dist < fadeDistance ? 1 : 1 - (dist - fadeDistance) / (visibleDistance - fadeDistance);
            const tag = this._tag(shown++);
            tag.name.textContent = session.nameOf(car);
            tag.name.style.opacity = String(opacity);
            tag.fill.style.width = `${car.health * 100}%`;
            tag.root.style.left = `${((_p.x + 1) / 2) * width}px`;
            tag.root.style.top = `${((1 - _p.y) / 2) * height}px`;
        }
        for (let i = shown; i < this._names.length; i++) this._names[i].root.style.display = 'none';

        const firstPerson = session.firstPerson;
        this._crosshair.style.display = firstPerson ? '' : 'none';
        const target = firstPerson ? aimedCar(session, eye, _camDir, visibleDistance) : null;
        this._bar.style.display = target ? '' : 'none';
        if (target) this._barFill.style.width = `${target.health * 100}%`;
    }

    /**
     * Hides the tags and the crosshair, for when the race view is covered.
     */
    hide(): void {
        for (const tag of this._names) tag.root.style.display = 'none';
        this._crosshair.style.display = 'none';
        this._bar.style.display = 'none';
    }

    private _tag(index: number): NameTag {
        let tag = this._names[index];
        if (!tag) {
            const root = document.createElement('div');
            root.style.position = 'absolute';
            // GuiDefaultProfile: Arial 14. The text sits centered above the point.
            const name = document.createElement('div');
            Object.assign(name.style, {
                position: 'absolute',
                font: arialFont(14),
                color: NAME_COLOR,
                whiteSpace: 'nowrap',
                transform: 'translate(-50%, -100%)',
            });
            // The car's health above the name (`damageRect`, `damageOffset`, damage colors of the name HUD).
            const bar = document.createElement('div');
            Object.assign(bar.style, {
                position: 'absolute',
                left: guiPx(-NAME_BAR.width / 2),
                top: guiPx(NAME_BAR.offsetY),
                width: guiPx(NAME_BAR.width),
                height: guiPx(NAME_BAR.height),
                boxSizing: 'border-box',
                border: `${guiPx(1)} solid rgb(255, 153, 0)`,
            });
            const fill = document.createElement('div');
            Object.assign(fill.style, { height: '100%', background: 'rgb(0, 255, 0)' });
            bar.append(fill);
            root.append(bar, name);
            this._nameLayer.append(root);
            tag = { root, name, fill };
            this._names.push(tag);
        }
        tag.root.style.display = '';
        return tag;
    }
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
