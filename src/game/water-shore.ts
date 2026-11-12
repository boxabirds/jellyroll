/**
 * Where the water of a hole really is. Water is level, so a hole has one surface height; the question is only which
 * points of the ground that surface covers. A point is wet if it is inside the hole's own outline and the ground there is
 * no higher than the surface. Every other point of the surface grid is put just under the ground, so a triangle that
 * crosses the shore dives under the terrain and never stands out in the air (on a hill, the ground beyond the downhill rim
 * falls away, and a flat surface left there would hang over it).
 */
import { edgeRadius, hazardFactor, type HoleDisc } from './hazards.ts';
import { courseCenter, courseHalfWidth, terrainHeight } from './terrain.ts';
import { HAZARD_FREE_UNTIL } from './tuning.ts';

/** A vertex is wet if it is inside the hole's outline (to this far beyond the rim), its lane factor is at least this, and its ground is no higher than the surface plus the tolerance. */
export const RIM_ALLOWANCE = 0.3;
export const LANE_THRESHOLD = 0.5;
export const SHORE_TOLERANCE = 0.02;
/** Dry vertices sit this far under the ground. */
export const BELOW_GROUND = 0.04;

export type ShoreVertex = { x: number; z: number; y: number; ground: number; wet: boolean; /** Part of the drawn surface: wet, or level but buried under higher ground (where the ground itself hides it and makes the shoreline). */ shown: boolean };

export function createShoreVertex(): ShoreVertex {
  return { x: 0, z: 0, y: 0, ground: 0, wet: false, shown: false };
}

/** The surface grid's vertex at (`u` across, `s` along the course) for a hole whose surface is at `level`. */
export function shoreVertex(disc: HoleDisc, level: number, u: number, s: number, out: ShoreVertex): ShoreVertex {
  const x = courseCenter(s) + u;
  return shoreVertexOn(disc, level, u, s, x, terrainHeight(x, -s), out);
}

/** The same, for a caller that already knows the ground height at the point (found a cheaper way, for many points at once). */
export function shoreVertexOn(disc: HoleDisc, level: number, u: number, s: number, x: number, ground: number, out: ShoreVertex): ShoreVertex {
  const du = u - disc.u, ds = s - disc.s;
  // The hole's own ragged outline, not its soft edge: inside it, wherever the ground is below the surface, there is water.
  const inside = s >= HAZARD_FREE_UNTIL && Math.sqrt(du * du + ds * ds) <= edgeRadius(disc.radius, disc.seed, Math.atan2(ds, du)) + RIM_ALLOWANCE;
  const wet = inside && hazardFactor(u, s, courseHalfWidth(s)) >= LANE_THRESHOLD && ground <= level + SHORE_TOLERANCE;
  // Where the ground is higher than the surface, the surface stays level underneath it: the ground hides it, and the line
  // where they cross is the shore, exact to the pixel. Only a point over lower ground that is not this pool's is dropped.
  const buried = ground > level + SHORE_TOLERANCE;
  out.x = x; out.z = -s; out.ground = ground; out.wet = wet; out.shown = wet || buried;
  out.y = out.shown ? level : Math.min(level, ground - BELOW_GROUND);
  return out;
}
