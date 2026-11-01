import * as THREE from 'three';

/**
 * Torque's fog, shared by every material that calls {@link useTorqueFog}.
 *
 * Distance haze starts at `fogDistance` and reaches full fog at `visibleDistance` with a
 * quadratic ease-out (`SceneState::getHaze`). A height band ("fog volume") adds fog for the
 * part of the view ray that runs inside it.
 */
export const torqueFogUniforms = {
    torqueFogColor: { value: new THREE.Color(0.8, 0.8, 0.8) },
    /** x: fogDistance, y: visibleDistance. */
    torqueFogRange: { value: new THREE.Vector2(400, 500) },
    /** x: visible distance inside the volume (0 = no volume), y: bottom height, z: top height. */
    torqueFogVolume: { value: new THREE.Vector3(0, 0, 0) },
    /** 1 draws the fog, 0 turns it off (a debug switch). */
    torqueFogEnabled: { value: 1 },
};

const PARS_VERTEX = /* glsl */ `
varying vec3 vTorqueFogWorld;
`;

const VERTEX = /* glsl */ `
vTorqueFogWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const PARS_FRAGMENT = /* glsl */ `
uniform vec3 torqueFogColor;
uniform vec2 torqueFogRange;
uniform vec3 torqueFogVolume;
uniform float torqueFogEnabled;
varying vec3 vTorqueFogWorld;

float torqueFogAmount(vec3 worldPos) {
    float d = distance(cameraPosition, worldPos);
    float haze = 0.0;
    if (d > torqueFogRange.y) {
        haze = 1.0;
    } else if (d > torqueFogRange.x) {
        float s = (d - torqueFogRange.x) / (torqueFogRange.y - torqueFogRange.x);
        haze = 2.0 * s - s * s;
    }
    if (torqueFogVolume.x > 0.0) {
        float lo = min(cameraPosition.z, worldPos.z);
        float hi = max(cameraPosition.z, worldPos.z);
        float overlap = max(0.0, min(hi, torqueFogVolume.z) - max(lo, torqueFogVolume.y));
        float dz = hi - lo;
        float inside = dz > 0.001 ? d * overlap / dz : (lo >= torqueFogVolume.y && lo <= torqueFogVolume.z ? d : 0.0);
        haze += inside / torqueFogVolume.x;
    }
    return clamp(haze, 0.0, 1.0) * torqueFogEnabled;
}
`;

const FRAGMENT = /* glsl */ `
gl_FragColor.rgb = mix(gl_FragColor.rgb, torqueFogColor, torqueFogAmount(vTorqueFogWorld));
`;

/**
 * Makes `material` use Torque's fog instead of three.js fog.
 *
 * The shader must declare `transformed` in the vertex stage before `#include <fog_vertex>`,
 * as the built-in materials do.
 */
export function useTorqueFog<T extends THREE.Material>(material: T): T {
    (material as unknown as { fog: boolean }).fog = false;
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        Object.assign(shader.uniforms, torqueFogUniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <fog_pars_vertex>', PARS_VERTEX)
            .replace('#include <fog_vertex>', VERTEX);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <fog_pars_fragment>', PARS_FRAGMENT)
            .replace('#include <fog_fragment>', FRAGMENT);
    };
    material.customProgramCacheKey = () => 'torque-fog';
    material.needsUpdate = true;
    return material;
}
