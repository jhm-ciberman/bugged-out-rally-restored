import * as THREE from 'three';
import type { IUpdatable } from '../IUpdatable';
import { useTorqueFog } from '../render/TorqueFog';

/** Meters per repeat of the water texture (legacy fluid path: `squareSize * 6`). */
const TEXTURE_METERS = 48;
/** Grid spacing of the wave mesh, in meters. */
const CELL = 8;

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
}

/**
 * The surface of a Torque water block: two drifting layers of the surface texture over a gentle wave
 * (`fluidRender.cc`, legacy path used when `UseDepthMask` is 0).
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
            },
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
                varying vec2 vWorldXY;
                void main() {
                    vec2 drift = vec2(time * 0.02, 0.03 * cos(6.2831853 * time / 8.0));
                    vec2 uv = vWorldXY / textureMeters;
                    vec4 a = texture2D(map, uv + drift);
                    // Second layer: rotated 30 degrees about the texture origin.
                    float c = 0.8660254;
                    float s = 0.5;
                    vec2 uv2 = mat2(c, s, -s, c) * uv + drift * parallax;
                    vec4 b = texture2D(map, uv2);
                    // Two passes blended over the scene, each with the surface opacity.
                    vec3 color = mix(a.rgb, b.rgb, 1.0 / (2.0 - opacity));
                    float alpha = 1.0 - (1.0 - opacity) * (1.0 - opacity);
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
