import * as THREE from "three";
import type { IUpdatable } from "./IUpdatable";
import { SpinningCube } from "./entities/SpinningCube";

/**
 * Owns the render loop, the three.js scene/camera/renderer, and every
 * updatable entity in the world. Call {@link run} to start, {@link dispose}
 * to tear down.
 */
export class Game {
  private readonly _scene = new THREE.Scene();
  private readonly _camera: THREE.PerspectiveCamera;
  private readonly _renderer: THREE.WebGLRenderer;
  private readonly _timer = new THREE.Timer();
  private readonly _entities: IUpdatable[] = [];

  constructor(private readonly _container: HTMLElement) {
    this._scene.background = new THREE.Color(0x141418);

    this._camera = new THREE.PerspectiveCamera(60, this._aspect, 0.1, 100);
    this._camera.position.set(0, 1.2, 4);
    this._camera.lookAt(0, 0, 0);

    this._renderer = new THREE.WebGLRenderer({ antialias: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._container.appendChild(this._renderer.domElement);

    this._addLights();
    this._spawn(new SpinningCube(this._scene));

    window.addEventListener("resize", this._onResize);
  }

  /**
   * Starts the per-frame loop.
   */
  run(): void {
    this._renderer.setAnimationLoop(this._tick);
  }

  /**
   * Stops the loop and releases resources and listeners.
   */
  dispose(): void {
    this._renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this._onResize);
    this._renderer.dispose();
  }

  /**
   * Registers an entity to be advanced every frame.
   */
  private _spawn(entity: IUpdatable): void {
    this._entities.push(entity);
  }

  private _addLights(): void {
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 2);
    this._scene.add(key);
  }

  private get _aspect(): number {
    return window.innerWidth / window.innerHeight;
  }

  // Arrow fields so `this` stays bound when passed as callbacks.
  private readonly _tick = (): void => {
    this._timer.update();
    const dt = this._timer.getDelta();
    for (const entity of this._entities) {
      entity.update(dt);
    }
    this._renderer.render(this._scene, this._camera);
  };

  private readonly _onResize = (): void => {
    this._camera.aspect = this._aspect;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
