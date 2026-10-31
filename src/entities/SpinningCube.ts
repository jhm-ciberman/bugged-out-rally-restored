import * as THREE from "three";
import type { IUpdatable } from "../IUpdatable";

/**
 * Demo entity: a cube that spins in place. Replace with real game entities.
 */
export class SpinningCube implements IUpdatable {
  private readonly _mesh: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this._mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 1.5, 1.5),
      new THREE.MeshStandardMaterial({ color: 0x8b1a1a, roughness: 0.4, metalness: 0.1 }),
    );
    scene.add(this._mesh);
  }

  update(deltaSeconds: number): void {
    this._mesh.rotation.x += deltaSeconds * 0.6;
    this._mesh.rotation.y += deltaSeconds * 1.0;
  }
}
