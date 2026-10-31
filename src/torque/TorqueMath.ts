import * as THREE from "three";

/**
 * Parses a space separated list of numbers, such as `"1 0 0 90"`.
 *
 * Missing components are filled with `fallback`.
 */
export function parseNumbers(value: string | undefined, count: number, fallback = 0): number[] {
  const parts = (value ?? "").trim().split(/\s+/).filter((p) => p !== "").map(Number);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const n = parts[i];
    out.push(n === undefined || Number.isNaN(n) ? fallback : n);
  }
  return out;
}

/**
 * Parses a Torque point, such as a `position` or `scale` field.
 */
export function parseVector(value: string | undefined, fallback = 0): THREE.Vector3 {
  const [x, y, z] = parseNumbers(value, 3, fallback);
  return new THREE.Vector3(x, y, z);
}

/**
 * Parses a Torque `rotation` field (`"axisX axisY axisZ angleDegrees"`) into a quaternion.
 *
 * Torque builds its matrix from the axis-angle quaternion with the off-diagonal
 * signs swapped (`m_quatF_set_matF`), so the angle turns the other way than in three.js.
 */
export function parseRotation(value: string | undefined): THREE.Quaternion {
  const [x, y, z, degrees] = parseNumbers(value, 4);
  const axis = new THREE.Vector3(x, y, z);
  if (axis.lengthSq() === 0 || degrees === 0) return new THREE.Quaternion();
  axis.normalize();
  return new THREE.Quaternion().setFromAxisAngle(axis, -THREE.MathUtils.degToRad(degrees));
}

/**
 * Parses a Torque color (`"r g b a"`, each 0-1).
 */
export function parseColor(value: string | undefined): THREE.Color {
  const [r, g, b] = parseNumbers(value, 3, 1);
  return new THREE.Color(r, g, b);
}
