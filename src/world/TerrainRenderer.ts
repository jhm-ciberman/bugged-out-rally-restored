import * as THREE from 'three';
import { TERRAIN_SIZE } from '../torque/TerrainFile';
import { TerrainHeightfield } from './TerrainHeightfield';

/** Most material layers a Torque terrain can have. */
const MAX_LAYERS = 8;

/**
 * Settings for drawing a terrain block.
 */
export interface TerrainLook {
    /** One texture per terrain material, in file order. */
    readonly textures: readonly THREE.Texture[];
    /** World meters covered by one repeat of a material texture. */
    readonly textureMeters: number;
    /** Direction the sunlight travels, normalized. */
    readonly sunDirection: THREE.Vector3;
    readonly sunColor: THREE.Color;
    readonly ambientColor: THREE.Color;
}

/**
 * Builds the meshes that draw a terrain block, repeated around the center block
 * so the edges of the map are never empty, like in Torque.
 */
export function createTerrainObject(field: TerrainHeightfield, look: TerrainLook, repeat = 1): THREE.Group {
    const geometry = buildGeometry(field);
    const material = buildMaterial(field, look);
    const group = new THREE.Group();
    group.name = 'Terrain';
    const size = field.blockSize;
    for (let by = -repeat; by <= repeat; by++) {
        for (let bx = -repeat; bx <= repeat; bx++) {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(field.originX + bx * size, field.originY + by * size, 0);
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            group.add(mesh);
        }
    }
    return group;
}

function buildGeometry(field: TerrainHeightfield): THREE.BufferGeometry {
    const n = TERRAIN_SIZE + 1;
    const s = field.squareSize;
    const positions = new Float32Array(n * n * 3);
    const normals = new Float32Array(n * n * 3);
    const uvs = new Float32Array(n * n * 2);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = x + y * n;
            positions[i * 3] = x * s;
            positions[i * 3 + 1] = y * s;
            positions[i * 3 + 2] = field.sample(x, y);
            // Central differences on the repeating grid, so the normals match across block edges.
            const dx = field.sample(x + 1, y) - field.sample(x - 1, y);
            const dy = field.sample(x, y + 1) - field.sample(x, y - 1);
            const nx = -dx;
            const ny = -dy;
            const nz = 2 * s;
            const len = Math.hypot(nx, ny, nz);
            normals[i * 3] = nx / len;
            normals[i * 3 + 1] = ny / len;
            normals[i * 3 + 2] = nz / len;
            uvs[i * 2] = x / TERRAIN_SIZE;
            uvs[i * 2 + 1] = y / TERRAIN_SIZE;
        }
    }

    const indices = new Uint32Array(TERRAIN_SIZE * TERRAIN_SIZE * 6);
    let k = 0;
    for (let y = 0; y < TERRAIN_SIZE; y++) {
        for (let x = 0; x < TERRAIN_SIZE; x++) {
            const bl = x + y * n;
            const br = bl + 1;
            const tl = bl + n;
            const tr = tl + 1;
            if (TerrainHeightfield.isSplit45(x, y)) {
                indices.set([bl, br, tr, bl, tr, tl], k);
            } else {
                indices.set([bl, br, tl, br, tr, tl], k);
            }
            k += 6;
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
    return geometry;
}

function buildMaterial(field: TerrainHeightfield, look: TerrainLook): THREE.ShaderMaterial {
    const layers = field.file.materials.slice(0, MAX_LAYERS);
    // Pack the blend weights four layers per RGBA texture.
    const weightTextures: THREE.DataTexture[] = [];
    for (let t = 0; t < 2; t++) {
        const data = new Uint8Array(TERRAIN_SIZE * TERRAIN_SIZE * 4);
        for (let c = 0; c < 4; c++) {
            const layer = layers[t * 4 + c];
            if (!layer) continue;
            for (let i = 0; i < TERRAIN_SIZE * TERRAIN_SIZE; i++) data[i * 4 + c] = layer.alpha[i];
        }
        const tex = new THREE.DataTexture(data, TERRAIN_SIZE, TERRAIN_SIZE, THREE.RGBAFormat);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        weightTextures.push(tex);
    }

    const textures = look.textures.slice(0, MAX_LAYERS);
    for (const tex of textures) {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.NoColorSpace;
    }
    const placeholder = new THREE.DataTexture(new Uint8Array([255, 0, 255, 255]), 1, 1);
    placeholder.needsUpdate = true;
    while (textures.length < MAX_LAYERS) textures.push(placeholder);

    return new THREE.ShaderMaterial({
        fog: true,
        uniforms: THREE.UniformsUtils.merge([
            THREE.UniformsLib.fog,
            {
                weights0: { value: weightTextures[0] },
                weights1: { value: weightTextures[1] },
                layers: { value: textures },
                layerCount: { value: layers.length },
                // A texel half a sample in, so the weight of grid point i is read at its own vertex.
                halfTexel: { value: 0.5 / TERRAIN_SIZE },
                textureRepeat: { value: (TERRAIN_SIZE * field.squareSize) / look.textureMeters },
                sunDirection: { value: look.sunDirection.clone() },
                sunColor: { value: look.sunColor.clone() },
                ambientColor: { value: look.ambientColor.clone() },
            },
        ]),
        vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vNormal = normal;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
        fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform sampler2D weights0;
      uniform sampler2D weights1;
      uniform sampler2D layers[${MAX_LAYERS}];
      uniform int layerCount;
      uniform float halfTexel;
      uniform float textureRepeat;
      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      uniform vec3 ambientColor;
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vec2 wuv = vUv + halfTexel;
        vec4 w0 = texture2D(weights0, wuv);
        vec4 w1 = texture2D(weights1, wuv);
        vec2 tuv = vUv * textureRepeat;
        vec3 color = texture2D(layers[0], tuv).rgb * w0.r
                   + texture2D(layers[1], tuv).rgb * w0.g
                   + texture2D(layers[2], tuv).rgb * w0.b
                   + texture2D(layers[3], tuv).rgb * w0.a
                   + texture2D(layers[4], tuv).rgb * w1.r
                   + texture2D(layers[5], tuv).rgb * w1.g
                   + texture2D(layers[6], tuv).rgb * w1.b
                   + texture2D(layers[7], tuv).rgb * w1.a;
        float total = dot(w0, vec4(1.0)) + dot(w1, vec4(1.0));
        color /= max(total, 0.0001);
        float diffuse = max(dot(normalize(vNormal), -sunDirection), 0.0);
        vec3 light = min(ambientColor + sunColor * diffuse, vec3(1.0));
        gl_FragColor = vec4(color * light, 1.0);
        #include <fog_fragment>
      }
    `,
    });
}
