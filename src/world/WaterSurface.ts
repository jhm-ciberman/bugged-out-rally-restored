import * as THREE from 'three';
import { useTorqueFog } from '../render/TorqueFog';

/** Meters per repeat of the water texture (legacy fluid path: `squareSize * 6`). */
const TEXTURE_METERS = 48;
/** Grid spacing of the wave mesh, in meters. */
const CELL = 8;
/** Size of a terrain tile; tiled water repeats with the same period (`fluid::IsFluidAtXY`). */
const WATER_TILE = 2048;
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
 *
 * @param shore For the shore map: past the shore depth the alpha falls again, so the shore texture only
 *     shows in a band along the coast.
 */
export function depthAlpha(depth: number, fade: ShoreFade, shore = false): number {
    if (depth <= 0) return fade.minAlpha;
    const range = fade.maxAlpha - fade.minAlpha;
    const ramp = (t: number) => range * THREE.MathUtils.clamp(t, 0, 1) ** (1 / fade.depthGradient) + fade.minAlpha;
    if (depth < fade.shoreDepth) return ramp(depth / fade.shoreDepth);
    return shore ? fade.maxAlpha - ramp((depth - fade.shoreDepth) / fade.shoreDepth) : fade.maxAlpha;
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
    shore = false,
): THREE.DataTexture {
    const data = new Uint8Array(DEPTH_MAP_SIZE * DEPTH_MAP_SIZE);
    for (let t = 0; t < DEPTH_MAP_SIZE; t++) {
        for (let s = 0; s < DEPTH_MAP_SIZE; s++) {
            // Sampled at the texel centers, where the GPU reads them.
            const x = min.x + ((s + 0.5) * size.x) / DEPTH_MAP_SIZE;
            const y = min.y + ((t + 0.5) * size.y) / DEPTH_MAP_SIZE;
            const alpha = depthAlpha(surfaceZ - groundAt(x, y), fade, shore);
            data[t * DEPTH_MAP_SIZE + s] = Math.round(THREE.MathUtils.clamp(alpha, 0, 1) * 255);
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
    /** Whether the area repeats every terrain tile (`tile`). */
    readonly tile: boolean;
    /** How far around the camera the surface is drawn, in meters (the visible distance). */
    readonly coverRadius: number;
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
    /** The extra passes of the depth map path, or null without a depth map. */
    readonly passes: WaterPasses | null;
}

/**
 * The shore, specular and environment passes of depth-mask water (`fluidRender.cc`).
 */
export interface WaterPasses {
    /** Alpha of the shore band (the depth map built in shore mode). */
    readonly shoreMap: THREE.Texture;
    /** Texture drawn along the shore (`ShoreTexture`). */
    readonly shoreTexture: THREE.Texture;
    /** Shore texture repeats across the water area (`TessShore`). */
    readonly shoreTessellation: number;
    /** Where the sun glints (`specularMaskTex`). */
    readonly specularMask: THREE.Texture;
    readonly specularColor: THREE.Color;
    readonly specularPower: number;
    /** Unit vector toward the sun. */
    readonly toSun: THREE.Vector3;
    /** Sky reflected on the water (`envMapOverTexture`). */
    readonly envMap: THREE.Texture;
    readonly envMapIntensity: number;
}

/**
 * The surface of a Torque water block: two drifting layers of the surface texture over a gentle wave
 * (`fluidRender.cc`). With a depth map, shallow water fades out toward the shore.
 */
export class WaterSurface {
    readonly object: THREE.Mesh;
    private readonly _time = { value: 0 };

    constructor(settings: WaterSettings) {
        // A square around the camera, moved in whole cells so the waves stay put; the shader keeps only
        // the parts over the water area and its copies.
        const cells = Math.ceil((settings.coverRadius * 2) / CELL) + 2;
        const geometry = new THREE.PlaneGeometry(cells * CELL, cells * CELL, cells, cells);

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
                tilePeriod: { value: settings.tile ? WATER_TILE : 0 },
                shoreMap: { value: settings.passes?.shoreMap ?? null },
                shoreTexture: { value: repeat(settings.passes?.shoreTexture) },
                shoreTessellation: { value: settings.passes?.shoreTessellation ?? 1 },
                specularMask: { value: repeat(settings.passes?.specularMask) },
                specularColor: { value: settings.passes?.specularColor ?? new THREE.Color(1, 1, 1) },
                specularPower: { value: settings.passes?.specularPower ?? 1 },
                toSun: { value: settings.passes?.toSun ?? new THREE.Vector3(0, 0, 1) },
                envMap: { value: repeat(settings.passes?.envMap) },
                envMapIntensity: { value: settings.passes?.envMapIntensity ?? 0 },
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
            defines: {
                ...(settings.depthMap ? { USE_DEPTH_MAP: '' } : {}),
                ...(settings.passes ? { USE_WATER_PASSES: '' } : {}),
            },
            vertexShader: /* glsl */ `
                #include <fog_pars_vertex>
                uniform float time;
                uniform float surfaceZ;
                uniform float waveFactor;
                varying vec2 vWorldXY;
                varying vec3 vWorldPos;
                void main() {
                    vec4 world = modelMatrix * vec4(position, 1.0);
                    // Waves use terrain-local meters (world + 1024).
                    vec2 local = world.xy + 1024.0;
                    world.z = surfaceZ + (sin(0.05 * local.x + time) + sin(0.05 * local.y + time)) * waveFactor;
                    vWorldXY = local;
                    vWorldPos = world.xyz;
                    // The fog code expects the local position in "transformed"; the model matrix only moves.
                    vec3 transformed = world.xyz - modelMatrix[3].xyz;
                    vec4 mvPosition = viewMatrix * world;
                    gl_Position = projectionMatrix * mvPosition;
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
                uniform float tilePeriod;
                uniform float tessellation;
                uniform vec2 flow;
                uniform vec3 distort;
                uniform sampler2D shoreMap;
                uniform sampler2D shoreTexture;
                uniform float shoreTessellation;
                uniform sampler2D specularMask;
                uniform vec3 specularColor;
                uniform float specularPower;
                uniform vec3 toSun;
                uniform sampler2D envMap;
                uniform float envMapIntensity;
                varying vec2 vWorldXY;
                varying vec3 vWorldPos;

                // Draws a pass with straight alpha over premultiplied color, like SRC_ALPHA, ONE_MINUS_SRC_ALPHA.
                vec4 over(vec4 below, vec3 color, float alpha) {
                    return vec4(color * alpha + below.rgb * (1.0 - alpha), alpha + below.a * (1.0 - alpha));
                }

                void main() {
                    // Position inside the water area; tiled water repeats with the terrain (fluid::IsFluidAtXY).
                    vec2 inArea = vWorldXY - 1024.0 - areaMin;
                    if (tilePeriod > 0.0) inArea = mod(inArea, tilePeriod);
                    if (any(lessThan(inArea, vec2(0.0))) || any(greaterThan(inArea, areaSize))) discard;
                    #ifdef USE_DEPTH_MAP
                        // The depth map path draws both layers at full opacity, faded by the map.
                        float layerAlpha = texture2D(depthMap, inArea / areaSize).r;
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
                        vec2 uv = inArea / areaSize * tessellation + wobble;
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
                    vec4 result = over(over(vec4(0.0), a.rgb, layerAlpha), b.rgb, layerAlpha);
                    #ifdef USE_WATER_PASSES
                        vec2 area = inArea / areaSize;
                        // Shore: its own repeat, the same wobble and drift, faded by the shore band.
                        vec4 shore = texture2D(shoreTexture, area * shoreTessellation + wobble + drift);
                        result = over(result, shore.rgb, shore.a * texture2D(shoreMap, area).r);
                        // Specular: the mask turned 30 degrees and scaled by 0.2, lit by the sun's half angle.
                        vec3 eyeVec = normalize(cameraPosition - vWorldPos);
                        vec3 halfVec = normalize(toSun + eyeVec);
                        float glint = pow(max(halfVec.z, 0.0), specularPower);
                        vec4 mask = texture2D(specularMask, mat2(c, s, -s, c) * (uv * 0.2));
                        result = over(result, mask.rgb * specularColor * glint, mask.a * glint * layerAlpha);
                        // Environment: a reflection lookup from the eye-to-point vector, with a liquid wobble.
                        vec3 v = vec3(vWorldPos.x - cameraPosition.x, cameraPosition.y - vWorldPos.y,
                            max(abs(vWorldPos.z - cameraPosition.z), 0.001));
                        float dist = length(vWorldPos - cameraPosition);
                        vec2 envUv = dist < 0.001 ? vec2(0.0) : v.xy * ((dist - v.z) / (dist * dist));
                        float a1 = cos(vWorldXY.x / 150.0 + time / distort.z);
                        float a2 = sin(vWorldXY.y / 150.0 + time / distort.z);
                        envUv = envUv * 0.5 + 0.5 + vec2(a1, a2) * 0.01;
                        vec4 env = texture2D(envMap, envUv);
                        float swing = (a1 + a2) * 0.15 + 0.5;
                        result = over(result, env.rgb, env.a * swing * envMapIntensity * layerAlpha);
                    #endif
                    vec3 color = result.a > 0.0 ? result.rgb / result.a : vec3(0.0);
                    float alpha = result.a;
                    gl_FragColor = vec4(color, alpha);
                    #include <fog_fragment>
                }
            `,
        });
        this.object = new THREE.Mesh(geometry, useTorqueFog(material));
        this.object.name = 'Water';
        this.object.renderOrder = 10;
        // The vertex shader lifts the surface to the water height, away from the geometry bounds.
        this.object.frustumCulled = false;
    }

    /**
     * Advances the waves and keeps the surface around `camera`.
     */
    update(deltaSeconds: number, camera: THREE.Camera): void {
        this._time.value += deltaSeconds;
        this.object.position.set(
            Math.round(camera.position.x / CELL) * CELL,
            Math.round(camera.position.y / CELL) * CELL,
            0,
        );
    }
}

/**
 * Makes a texture tile, and returns it.
 */
function repeat(tex: THREE.Texture | undefined): THREE.Texture | null {
    if (!tex) return null;
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
}
