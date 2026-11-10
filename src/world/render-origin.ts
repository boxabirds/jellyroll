/**
 * Floating origin. The simulation runs in absolute world coordinates (doubles),
 * but the GPU works in 32-bit floats, which lose centimetres of precision a few
 * tens of kilometres from zero. Everything drawn is therefore placed relative
 * to an origin that hops down the hill with the jelly.
 *
 * The hop size is a whole number of terrain cells and of both grass texture
 * tiles, so a rebase is invisible: geometry and world-space texturing land on
 * exactly the same pixels.
 */
export const REBASE_DISTANCE = 960;

export class RenderOrigin {
  /** World Z that maps to render-space Z = 0. */
  z = 0;

  /** Moves the origin if `worldZ` has strayed too far. Returns true on a hop. */
  follow(worldZ: number): boolean {
    const target = Math.round(worldZ / REBASE_DISTANCE) * REBASE_DISTANCE;
    if (target === this.z) return false;
    this.z = target;
    return true;
  }
}
