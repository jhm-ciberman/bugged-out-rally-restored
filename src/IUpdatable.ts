/**
 * Anything the game advances once per frame.
 */
export interface IUpdatable {
  /**
   * Advance this object by the elapsed time since the last frame.
   */
  update(deltaSeconds: number): void;
}
