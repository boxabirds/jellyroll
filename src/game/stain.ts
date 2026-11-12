/**
 * The colour the jelly takes on from the hole it has been in, and how it wears off: red from lava,
 * blue from water, white when a shard stabs it. Pure and per physics step; the jelly's material
 * reads `kind` and `level`.
 */
import { CAVE, DUNES, ICE, LAVA, MEADOW } from './biomes.ts';
import type { Ball } from './physics.ts';

/** How fast a stain comes on while the jelly is in the hole (full strength per second), and how long a full one takes to wear off. */
export const STAIN_RISE_RATE = 6;
export const STAIN_FADE_SECONDS = 1.8;
/** A stab leaves the jelly white at once. */
const STAB_LEVEL = 1;
/** In the hole a stain comes up to this share of full, scaled by how deep in the jelly is. */
const IN_HOLE_LEVEL = 1;
/** Kinds that stain the jelly while it is in them; shards only on a stab. */
const STAINING = new Set<number>([MEADOW, DUNES, LAVA, CAVE]);

export const NO_STAIN = -1;

export class Stain {
  /** The biome whose hole left the stain, or NO_STAIN. */
  kind = NO_STAIN;
  /** 0 (clean) to 1 (fully stained). */
  level = 0;

  reset() {
    this.kind = NO_STAIN;
    this.level = 0;
  }

  /** Call after each physics step. */
  step(ball: Ball, dt: number) {
    const kind = ball.hazardKind;
    let target = 0;
    if (ball.hazardDepth > 0 && STAINING.has(kind)) target = IN_HOLE_LEVEL * Math.min(1, ball.hazardDepth);
    if (ball.stabs > 0 && kind === ICE) { this.kind = ICE; this.level = STAB_LEVEL; return; }
    if (target > this.level) {
      if (this.kind !== kind) this.kind = kind;
      this.level = Math.min(target, this.level + STAIN_RISE_RATE * dt);
      return;
    }
    this.level = Math.max(0, this.level - dt / STAIN_FADE_SECONDS);
    if (this.level === 0) this.kind = NO_STAIN;
  }
}
