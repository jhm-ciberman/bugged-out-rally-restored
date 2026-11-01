import * as THREE from 'three';
import type { IUpdatable } from '../IUpdatable';
import { useTorqueFog } from '../render/TorqueFog';

/** Meters per repeat of the water texture (legacy fluid path: `squareSize * 6`). */
const TEXTURE_METERS = 48;
/** Grid spacing of the wave mesh, in meters. */
const CELL = 8;
/** Texels per side of the depth alpha map (`eDepthMapResolution`). */
const DEPTH_MAP_SIZE = 512;

/**
 * How a water block fades out over shallow ground (`ShoreDepth`, `MinAlpha`, `MaxAlpha`, `DepthGradient`).
 */
export interface ShoreFade {
    /** Depth, in meters, where the water reaches its full alpha. */
    readonly shoreDepth: number;
    readonly minAlpha: number;
    readonly maxAlpha: number;
    /** Bends the fade: above 1 the water turns solid sooner, below 1 later. */
    readonly depthGradient: number;
}

/**
 * Returns the alpha of the water `depth` meters above the ground (`WaterBlock::GenerateDepthTextures`).
 */
export function depthAlpha(depth: number, fade: ShoreFade): number {
    if (depth <= 0) return fade.minAlpha;
    if (depth >= fade.shoreDepth) return fade.maxAlpha;
    const range = fade.maxAlpha - fade.minAlpha;
    return range * (depth / fade.shoreDepth) ** (1 / fade.depthGradient) + fade.minAlpha;
}

/**
 * Builds the depth alpha map of a water area from the ground height under it.
 */
export function depthAlphaMap(
    min: THREE.Vector2,
    size: THREE.Vector2,
    surfaceZ: number,
    groundAt: (x: number, y: number) => number,
    fade: ShoreFade,
): THREE.DataTexture {
    const data = new Uint8Array(DEPTH_MAP_SIZE * DEPTH_MAP_SIZE);
    for (let t = 0; t < DEPTH_MAP_SIZE; t++) {
        for (let s = 0; s < DEPTH_MAP_SIZE; s++) {
            // Sampled at the texel centers, where the GPU reads them.
            const x = min.x + ((s + 0.5) * size.x) / DEPTH_MAP_SIZE;
            const y = min.y + ((t + 0.5) * size.y) / DEPTH_MAP_SIZE;
            data[t * DEPTH_MAP_SIZE + s] = Math.round(depthAlpha(surfaceZ - groundAt(x, y), fade) * 255);
        }
    }
    const tex = new THREE.DataTexture(data, DEPTH_MAP_SIZE, DEPTH_MAP_SIZE, THREE.RedFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}

/**
 * Settings of a Torque `WaterBlock`.
 */
export interface WaterSettings {
    /** Minimum corner of the water area. */
    readonly min: THREE.Vector2;
    /** Size of the water area. */
    readonly size: THREE.Vector2;
    /** Height of the calm surface. */
    readonly surfaceZ: number;
    readonly texture: THREE.Texture;
    readonly opacity: number;
    readonly waveMagnitude: number;
    /** How far the second texture layer drifts compared to the first (`SurfaceParallax`). */
    readonly parallax: number;
    /**
     * Alpha by depth over the water area (`UseDepthMask`), or `null` to use `opacity` everywhere.
     * With a map, `opacity` is ignored, as in the engine.
     */
    readonly depthMap: THREE.Texture | null;
    /** Texture repeats across the water area (`TessSurface`); used with a depth map. */
    readonly tessellation: number;
    /** Texture scroll direction in degrees and speed in repeats per second (`FlowAngle`, `FlowRate`); used with a depth map. */
    readonly flowAngle: number;
    readonly flowRate: number;
    /** Texture wobble (`DistortMag`, `DistortGridScale`, `DistortTime`); used with a depth map. */
    readonly distortMagnitude: number;
    readonly distortGridScale: number;
    readonly distortTime: number;
}

/**
 * The surface of a Torque water block: two drifting layers of the surface texture over a gentle wave
 * (`fluidRender.cc`). With a depth map, shallow water fades out toward the shore.
 */
export class WaterSurface implements IUpdatable {
    readonly object: THREE.Mesh;
    private readonly _time = { value: 0 };

    constructor(settings: WaterSettings) {
        const cols = Math.max(1, Math.round(settings.size.x / CELL));
        const rows = Math.max(1, Math.round(settings.size.y / CELL));
        const geometry = new THREE.PlaneGeometry(settings.size.x, settings.size.y, cols, rows);
        geometry.translate(settings.min.x + settings.size.x / 2, settings.min.y + settings.size.y / 2, 0);

        const tex = settings.texture;
        tex.colorSpace = THREE.NoColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;

        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            uniforms: {
                map: { value: tex },
                time: this._time,
                surfaceZ: { value: settings.surfaceZ },
                waveFactor: { value: settings.waveMagnitude * 0.25 },
                opacity: { value: settings.opacity },
                parallax: { value: settings.parallax },
                textureMeters: { value: TEXTURE_METERS },
                depthMap: { value: settings.depthMap },
                areaMin: { value: settings.min },
                areaSize: { value: settings.size },
                tessellation: { value: settings.tessellation },
                flow: {
                    value: new THREE.Vector2(
                        Math.cos(THREE.MathUtils.degToRad(settings.flowAngle)),
                        Math.sin(THREE.MathUtils.degToRad(settings.flowAngle)),
                    ).multiplyScalar(settings.flowRate),
                },
                distort: {
                    value: new THREE.Vector3(
                        settings.distortMagnitude,
                        settings.distortGridScale,
                        Math.max(settings.distortTime, 1e-3),
                    ),
                },
            },
            defines: settings.depthMap ? { USE_DEPTH_MAP: '' } : {},
            vertexShader: /* glsl */ `
                #include <fog_pars_vertex>
                uniform float time;
                uniform float surfaceZ;
                uniform float waveFactor;
                varying vec2 vWorldXY;
                void main() {
                    vec3 transformed = position;
                    // Waves use terrain-local meters (world + 1024).
                    vec2 local = position.xy + 1024.0;
                    transformed.z = surfaceZ + (sin(0.05 * local.x + time) + sin(0.05 * local.y + time)) * waveFactor;
                    vWorldXY = local;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
                    #include <fog_vertex>
                }
            `,
            fragmentShader: /* glsl */ `
                #include <fog_pars_fragment>
                uniform sampler2D map;
                uniform float time;
                uniform float opacity;
                uniform float parallax;
                uniform float textureMeters;
                uniform sampler2D depthMap;
                uniform vec2 areaMin;
                uniform vec2 areaSize;
                uniform float tessellation;
                uniform vec2 flow;
                uniform vec3 distort;
                varying vec2 vWorldXY;
                void main() {
                    #ifdef USE_DEPTH_MAP
                        // The depth map path draws both layers at full opacity, faded by the map.
                        float layerAlpha = texture2D(depthMap, (vWorldXY - 1024.0 - areaMin) / areaSize).r;
                    #else
                        float layerAlpha = opacity;
                    #endif
                    float c = 0.8660254;
                    float s = 0.5;
                    #ifdef USE_DEPTH_MAP
                        // Repeats over the whole area, scrolls along the flow and wobbles.
                        vec2 drift = flow * time;
                        vec2 wobble = distort.x * vec2(
                            cos(vWorldXY.x * distort.y + time / distort.z),
                            sin(vWorldXY.y * distort.y + time / distort.z)
                        );
                        vec2 uv = (vWorldXY - 1024.0 - areaMin) / areaSize * tessellation + wobble;
                        vec4 a = texture2D(map, uv + drift);
                        // Second layer: the texture matrix rotates by 30 degrees after the parallax drift.
                        vec4 b = texture2D(map, mat2(c, s, -s, c) * (uv + drift * parallax));
                    #else
                        vec2 drift = vec2(time * 0.02, 0.03 * cos(6.2831853 * time / 8.0));
                        vec2 uv = vWorldXY / textureMeters;
                        vec4 a = texture2D(map, uv + drift);
                        // Second layer: rotated 30 degrees about the texture origin.
                        vec4 b = texture2D(map, mat2(c, s, -s, c) * uv + drift * parallax);
                    #endif
                    // Two passes blended over the scene, each with the layer alpha.
                    vec3 color = mix(a.rgb, b.rgb, 1.0 / (2.0 - layerAlpha));
                    float alpha = 1.0 - (1.0 - layerAlpha) * (1.0 - layerAlpha);
                    gl_FragColor = vec4(color, alpha);
                    #include <fog_fragment>
                }
            `,
        });
        this.object = new THREE.Mesh(geometry, useTorqueFog(material));
        this.object.name = 'Water';
        this.object.renderOrder = 10;
    }

    update(deltaSeconds: number): void {
        this._time.value += deltaSeconds;
    }
}
