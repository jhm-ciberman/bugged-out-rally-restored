import * as THREE from 'three';

/**
 * Plays the animations (sequences) of one shape, like a Torque shape thread: one sequence at a time,
 * either looping or once.
 */
export class ShapeThread {
    private readonly _mixer: THREE.AnimationMixer;
    private _action: THREE.AnimationAction | null = null;

    constructor(private readonly _model: THREE.Object3D) {
        this._mixer = new THREE.AnimationMixer(_model);
    }

    /**
     * Whether the shape has a sequence called `name`.
     */
    has(name: string): boolean {
        return this._clip(name) !== undefined;
    }

    /**
     * Starts sequence `name` from its beginning (`playThread`). A sequence played once holds its last pose.
     */
    play(name: string, loop: boolean): void {
        const clip = this._clip(name);
        if (!clip) return;
        this._action?.stop();
        this._action = this._mixer.clipAction(clip);
        this._action.reset();
        this._action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        this._action.clampWhenFinished = true;
        this._action.play();
    }

    /**
     * Stops the sequence and puts the shape back in its rest pose (`stopThread`).
     */
    stop(): void {
        this._action?.stop();
        this._action = null;
    }

    update(deltaSeconds: number): void {
        this._mixer.update(deltaSeconds);
    }

    private _clip(name: string): THREE.AnimationClip | undefined {
        const key = name.toLowerCase();
        return this._model.animations.find((c) => c.name.toLowerCase() === key);
    }
}
