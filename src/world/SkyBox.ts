import * as THREE from 'three';
import type { IUpdatable } from '../IUpdatable';
import { torqueFogUniforms } from '../render/TorqueFog';

/** Height of the fog band above the horizon, in sky box units (`OFFSET_HEIGHT` in sky.cc). */
const HORIZON_BAND = 60;

/**
 * Torque's sky box: four walls and a top, centered on the camera, clipped at the horizon,
 * with a band that fades from the fog color into the sky (`terrain/sky.cc`).
 */
export class SkyBox implements IUpdatable {
    readonly object = Object.assign(new THREE.Group(), { name: 'Sky' });

    /**
     * @param faces Textures for south, east, north and west walls, then the top (the order of the `.dml` file).
     * @param visibleDistance The mission's sky visible distance.
     */
    constructor(
        faces: readonly THREE.Texture[],
        visibleDistance: number,
        private readonly _camera: THREE.Camera,
    ) {
        const radius = visibleDistance * 0.95;
        const t = radius / Math.sqrt(3);
        // Top ring corners, in the order the engine walks the walls.
        const p = [
            [-t, -t],
            [t, -t],
            [t, t],
            [-t, t],
        ];
        const halfTexel = (d: number) => (i: number) => (i * (d - 1)) / d + 0.5 / d;

        for (let side = 0; side < 5; side++) {
            const tex = faces[side];
            if (!tex) continue;
            tex.colorSpace = THREE.NoColorSpace;
            tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
            const size = (tex.image as { width?: number } | undefined)?.width ?? 256;
            const inset = halfTexel(size);
            let corners: number[][];
            if (side < 4) {
                const a = p[side];
                const b = p[(side + 1) % 4];
                // P[s] top, P[s+1] top, P[s+1] bottom, P[s] bottom.
                corners = [
                    [a[0], a[1], t, 0, 0],
                    [b[0], b[1], t, 1, 0],
                    [b[0], b[1], -t, 1, 1],
                    [a[0], a[1], -t, 0, 1],
                ];
            } else {
                corners = [
                    [p[3][0], p[3][1], t, 0, 0],
                    [p[2][0], p[2][1], t, 1, 0],
                    [p[1][0], p[1][1], t, 1, 1],
                    [p[0][0], p[0][1], t, 0, 1],
                ];
            }
            const positions = new Float32Array(12);
            const uvs = new Float32Array(8);
            corners.forEach((c, i) => {
                positions.set([c[0], c[1], c[2]], i * 3);
                // Torque v=0 is the top image row; three.js v=1 is.
                uvs.set([inset(c[3]), 1 - inset(c[4])], i * 2);
            });
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
            geometry.setIndex([0, 1, 2, 0, 2, 3]);
            const mesh = new THREE.Mesh(geometry, createSkyMaterial(tex));
            mesh.frustumCulled = false;
            mesh.renderOrder = -1000;
            this.object.add(mesh);
        }
    }

    update(): void {
        this.object.position.copy(this._camera.position);
    }
}

function createSkyMaterial(map: THREE.Texture): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
        uniforms: {
            map: { value: map },
            fogColor: torqueFogUniforms.torqueFogColor,
            fogEnabled: torqueFogUniforms.torqueFogEnabled,
            band: { value: HORIZON_BAND },
        },
        vertexShader: /* glsl */ `
            varying vec2 vUv;
            varying float vHeight;
            void main() {
                vUv = uv;
                vHeight = position.z;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */ `
            uniform sampler2D map;
            uniform vec3 fogColor;
            uniform float fogEnabled;
            uniform float band;
            varying vec2 vUv;
            varying float vHeight;
            void main() {
                vec3 sky = texture2D(map, vUv).rgb;
                // Below the horizon the engine shows the clear color, which is the fog color.
                float k = vHeight <= 0.0 ? 1.0 : (1.0 - clamp(vHeight / band, 0.0, 1.0)) * fogEnabled;
                gl_FragColor = vec4(mix(sky, fogColor, k), 1.0);
            }
        `,
    });
}
