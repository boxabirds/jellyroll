/**
 * The shape of a merge over time, as pure functions (no rendering), so it can
 * be tested. See the constants in tuning.ts for the sequence and where it comes from.
 *
 * Phases, in order:
 *   0 approach  the mushroom flies to the jelly (only if it was pulled from a distance)
 *   1 contact   it presses against the jelly: it flattens, the jelly dents
 *   2 blend     a smooth union grows between them while the mushroom sinks in and
 *               shrinks, and its volume flows into the jelly
 *   3 done
 */
import { smoothstep } from './noise.ts';
import {
  MERGE_APPROACH_MAX_SECONDS, MERGE_APPROACH_SPEED, MERGE_BLEND_K_END, MERGE_BLEND_K_START, MERGE_BLEND_SECONDS,
  MERGE_CONTACT_SECONDS, MERGE_DENT_DEPTH, MERGE_FUSE_FRACTION, MERGE_PRESS, MERGE_UNION_IN, MUSHROOM_TOUCH,
} from './tuning.ts';

export const PHASE_APPROACH = 0;
export const PHASE_CONTACT = 1;
export const PHASE_BLEND = 2;
export const PHASE_DONE = 3;

/** Everything about one merge that stays fixed while it plays. */
export type MergeSpec = {
  radius: number;
  /** Centre-to-centre distances: where it started, where it touches, where it is pressed to, where it ends. */
  startDistance: number; touchDistance: number; pressDistance: number; endDistance: number;
  approachSeconds: number;
};

/** How the merge looks at one instant. */
export type MergeShape = {
  phase: number;
  distance: number;
  /** Radius the mushroom is drawn at: its own size, shrinking to nothing as it is absorbed. */
  size: number;
  /** 0..1: how flattened the mushroom is. */
  squash: number;
  /** 0..1: how far it has turned its cap toward the jelly. */
  tilt: number;
  /** 0..1: depth of the dent it makes in the jelly. */
  dent: number;
  /** 0..1: how much of the smooth union is switched on. */
  unionScale: number;
  /** Smooth-union blend radius, in metres. */
  k: number;
  /** 0..1: share of the mushroom's volume that is now in the jelly. */
  transferred: number;
};

export function createMergeSpec(): MergeSpec {
  return { radius: 0, startDistance: 0, touchDistance: 0, pressDistance: 0, endDistance: 0, approachSeconds: 0 };
}

export function createMergeShape(): MergeShape {
  return { phase: PHASE_APPROACH, distance: 0, size: 0, squash: 0, tilt: 0, dent: 0, unionScale: 0, k: 0, transferred: 0 };
}

/**
 * @param startDistance centre-to-centre distance when the merge began
 * @param jellyRadius   the jelly's radius at that moment
 */
export function setMergeSpec(spec: MergeSpec, startDistance: number, jellyRadius: number, mushroomRadius: number): MergeSpec {
  const touch = jellyRadius + mushroomRadius * MUSHROOM_TOUCH;
  spec.radius = mushroomRadius;
  spec.startDistance = startDistance;
  // Already overlapping when picked up: it presses in from where it is, not from further out.
  spec.touchDistance = Math.min(startDistance, touch);
  spec.approachSeconds = Math.min(MERGE_APPROACH_MAX_SECONDS, Math.max(0, (startDistance - touch) / MERGE_APPROACH_SPEED));
  spec.pressDistance = spec.touchDistance - MERGE_PRESS * mushroomRadius;
  spec.endDistance = MERGE_FUSE_FRACTION * (jellyRadius + mushroomRadius);
  return spec;
}

export function mergeDuration(spec: MergeSpec): number {
  return spec.approachSeconds + MERGE_CONTACT_SECONDS + MERGE_BLEND_SECONDS;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export function mergeShape(spec: MergeSpec, age: number, out: MergeShape): MergeShape {
  const approach = spec.approachSeconds, contact = MERGE_CONTACT_SECONDS;
  out.size = spec.radius;
  out.tilt = smoothstep(0, approach + contact, age);
  if (age < approach) {
    const t = age / approach;
    out.phase = PHASE_APPROACH;
    // Slow to start, then snatched in: the pull accelerates.
    out.distance = lerp(spec.startDistance, spec.touchDistance, t * t);
    out.squash = 0; out.dent = 0; out.unionScale = 0; out.k = spec.radius * MERGE_BLEND_K_START; out.transferred = 0;
    return out;
  }
  if (age < approach + contact) {
    const u = (age - approach) / contact;
    const press = 1 - (1 - u) * (1 - u);
    out.phase = PHASE_CONTACT;
    out.distance = lerp(spec.touchDistance, spec.pressDistance, press);
    out.squash = press; out.dent = press;
    out.unionScale = 0; out.k = spec.radius * MERGE_BLEND_K_START; out.transferred = 0;
    return out;
  }
  const s = Math.min(1, (age - approach - contact) / MERGE_BLEND_SECONDS);
  const e = smootherstep(s);
  out.phase = s >= 1 ? PHASE_DONE : PHASE_BLEND;
  out.distance = lerp(spec.pressDistance, spec.endDistance, e);
  // The pressure eases off as the two melt together.
  out.squash = 1 - smoothstep(0, 0.35, s);
  out.dent = 1 - smoothstep(0, 0.3, s);
  out.unionScale = smoothstep(0, MERGE_UNION_IN, s);
  out.k = spec.radius * lerp(MERGE_BLEND_K_START, MERGE_BLEND_K_END, e);
  out.transferred = e;
  out.size = spec.radius * Math.cbrt(1 - e);
  return out;
}

/** Depth of the dent in metres for a mushroom of `radius` pressing a jelly of `jellyRadius`. */
export function dentDepth(shape: MergeShape, radius: number, jellyRadius: number): number {
  return MERGE_DENT_DEPTH * shape.dent * Math.min(1, radius / (jellyRadius * 0.5));
}

// --- Smooth union of a jelly and a sphere, along one ray from the jelly's centre ----------

/** Polynomial smooth maximum: max(a, b), plus extra material within `k` of where they cross. */
export function smoothMax(a: number, b: number, k: number): number {
  if (k <= 0) return Math.max(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

/** How fast the far edge of a sphere falls away for rays that miss it, per metre of miss. */
export const MISS_SLOPE = 1.6;

/**
 * Distance along a ray from the origin to where it leaves a sphere of radius
 * `radius` centred `centreDistanceSquared` (squared) away, with `along` the
 * component of the centre along the ray. For rays that miss, a value that
 * keeps falling the further they miss, so the union fades out smoothly.
 */
export function sphereExit(along: number, centreDistanceSquared: number, radius: number): number {
  const perpendicularSquared = Math.max(0, centreDistanceSquared - along * along);
  const discriminant = radius * radius - perpendicularSquared;
  if (discriminant >= 0) return along + Math.sqrt(discriminant);
  return along - (Math.sqrt(perpendicularSquared) - radius) * MISS_SLOPE;
}

/** Radius of the union surface along a ray: the jelly's own radius `jelly` melted together with the sphere. */
export function unionRadius(jelly: number, along: number, centreDistanceSquared: number, sphereRadius: number, k: number): number {
  return smoothMax(jelly, sphereExit(along, centreDistanceSquared, sphereRadius), k);
}
