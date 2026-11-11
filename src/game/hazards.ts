/**
 * The holes: patches of ground that hurt the jelly, a pure function of position
 * like the rest of the world. A hole is a disc in valley coordinates (u across,
 * s along), one per grid cell at most. Three clear lanes run down the valley, so
 * however big and joined-up the holes get there are always three ways through.
 * Holes also cover the banks up to the ridge barrier, so riding up the wall is
 * no way round them.
 */
import { BIOME_LENGTH, dominantBiome } from './biomes.ts';
import { hash2, smoothstep } from './noise.ts';
import {
  HAZARD_BANK_OVERRUN,
  HAZARD_CELL,
  HAZARD_CHANCE_END,
  HAZARD_CHANCE_START,
  HAZARD_EDGE,
  HAZARD_FREE_UNTIL,
  HAZARD_FULL_AT,
  HAZARD_GROWTH_BIOMES,
  HAZARD_LANES,
  HAZARD_LANE_HALF_END,
  HAZARD_LANE_HALF_START,
  HAZARD_LANE_SOFT,
  HAZARD_LANE_SPACING,
  HAZARD_LANE_WANDER,
  HAZARD_LANE_WAVELENGTH,
  HAZARD_RADIUS_END,
  HAZARD_RADIUS_SPREAD,
  HAZARD_RADIUS_START,
  RIDGE_BARRIER_INSET,
  RIDGE_DISTANCE,
  WORLD_SEED,
} from './tuning.ts';

const TAU = Math.PI * 2;
const SEED_EXISTS = WORLD_SEED + 61;
const SEED_OFFSET_U = WORLD_SEED + 62;
const SEED_OFFSET_S = WORLD_SEED + 63;
const SEED_RADIUS = WORLD_SEED + 64;
const SEED_LANE_PHASE = WORLD_SEED + 65;
const SEED_LOOK = WORLD_SEED + 66;
const NEIGHBOURS = 1;

export type HazardSample = {
  /** 0 on clear ground, 1 in the middle of a hole. */
  depth: number;
  /** The biome whose kind of hole this is. */
  kind: number;
};

export function createHazardSample(): HazardSample {
  return { depth: 0, kind: 0 };
}

/** 0 at the start of the run, rising toward 1 as biomes go by: how big and how many the holes have got. */
export function hazardShape(s: number): number {
  return 1 - Math.exp(-Math.max(0, s - HAZARD_FREE_UNTIL) / BIOME_LENGTH / HAZARD_GROWTH_BIOMES);
}

export function laneHalfWidth(s: number): number {
  return HAZARD_LANE_HALF_START + (HAZARD_LANE_HALF_END - HAZARD_LANE_HALF_START) * hazardShape(s);
}

/** Valley-relative position of the centre of lane `index` (0..HAZARD_LANES-1) at `s`. */
export function laneCentre(index: number, s: number): number {
  const phase = hash2(index, 0, SEED_LANE_PHASE) * TAU;
  return (index - (HAZARD_LANES - 1) / 2) * HAZARD_LANE_SPACING + HAZARD_LANE_WANDER * Math.sin((s * TAU) / HAZARD_LANE_WAVELENGTH + phase);
}

/** 1 inside a lane, falling to 0 over HAZARD_LANE_SOFT beyond its edge. */
function laneShelter(u: number, s: number): number {
  const half = laneHalfWidth(s);
  let shelter = 0;
  for (let lane = 0; lane < HAZARD_LANES; lane++) {
    shelter = Math.max(shelter, 1 - smoothstep(half, half + HAZARD_LANE_SOFT, Math.abs(u - laneCentre(lane, s))));
  }
  return shelter;
}

/** How far across the valley (from its centre line) holes reach at a place where the valley is `halfWidth` wide. */
export function hazardReach(halfWidth: number): number {
  return halfWidth + RIDGE_DISTANCE - RIDGE_BARRIER_INSET + HAZARD_BANK_OVERRUN;
}

/** One hole before the lanes are cut out of it: a disc in valley coordinates. */
export type HoleDisc = { u: number; s: number; radius: number; kind: number; seed: number };

export function createHoleDisc(): HoleDisc {
  return { u: 0, s: 0, radius: 0, kind: 0, seed: 0 };
}

export function holeCellIndex(coordinate: number): number {
  return Math.floor(coordinate / HAZARD_CELL);
}

/**
 * Looking a cell up costs a handful of hashes and a biome lookup, and every height sample of the
 * terrain asks about nine cells, so answers are kept in a small direct-mapped cache (a miss just
 * recomputes; a collision just evicts).
 */
const CACHE_SLOTS = 8192;
const CACHE_MASK = CACHE_SLOTS - 1;
const CACHE_PRIME_I = 73856093;
const CACHE_PRIME_J = 19349663;
const FIELDS = 5;
const NO_ENTRY = 0, EMPTY_CELL = 1, HOLE_CELL = 2;
const cacheI = new Int32Array(CACHE_SLOTS);
const cacheJ = new Int32Array(CACHE_SLOTS);
const cacheState = new Uint8Array(CACHE_SLOTS);
const cacheValues = new Float64Array(CACHE_SLOTS * FIELDS);

function computeHole(i: number, j: number, out: HoleDisc): boolean {
  const centreS = (j + hash2(i, j, SEED_OFFSET_S)) * HAZARD_CELL;
  const ramp = smoothstep(HAZARD_FREE_UNTIL, HAZARD_FULL_AT, centreS);
  if (ramp === 0) return false;
  const shape = hazardShape(centreS);
  const chance = (HAZARD_CHANCE_START + (HAZARD_CHANCE_END - HAZARD_CHANCE_START) * shape) * ramp;
  if (hash2(i, j, SEED_EXISTS) >= chance) return false;
  const limit = HAZARD_RADIUS_START + (HAZARD_RADIUS_END - HAZARD_RADIUS_START) * shape;
  out.radius = limit * (1 - HAZARD_RADIUS_SPREAD * hash2(i, j, SEED_RADIUS));
  out.u = (i + hash2(i, j, SEED_OFFSET_U)) * HAZARD_CELL;
  out.s = centreS;
  out.kind = dominantBiome(centreS);
  out.seed = hash2(i, j, SEED_LOOK);
  return true;
}

/** Fills `out` with the hole of grid cell (`i` across, `j` along) and returns true, or returns false if the cell has none. */
export function holeInCell(i: number, j: number, out: HoleDisc): boolean {
  const slot = ((Math.imul(i, CACHE_PRIME_I) ^ Math.imul(j, CACHE_PRIME_J)) >>> 0) & CACHE_MASK;
  const base = slot * FIELDS;
  if (cacheState[slot] === NO_ENTRY || cacheI[slot] !== i || cacheJ[slot] !== j) {
    const found = computeHole(i, j, out);
    cacheI[slot] = i; cacheJ[slot] = j;
    cacheState[slot] = found ? HOLE_CELL : EMPTY_CELL;
    if (found) {
      cacheValues[base] = out.u; cacheValues[base + 1] = out.s; cacheValues[base + 2] = out.radius;
      cacheValues[base + 3] = out.kind; cacheValues[base + 4] = out.seed;
    }
    return found;
  }
  if (cacheState[slot] !== HOLE_CELL) return false;
  out.u = cacheValues[base]; out.s = cacheValues[base + 1]; out.radius = cacheValues[base + 2];
  out.kind = cacheValues[base + 3]; out.seed = cacheValues[base + 4];
  return true;
}

const disc = createHoleDisc();

/**
 * Depth of the hole at valley position (`u` across from the centre line, `s` along) where the
 * valley is `halfWidth` wide; the hole's kind goes into `out`. Returns the depth.
 */
export function hazardAt(u: number, s: number, halfWidth: number, out: HazardSample): number {
  out.depth = 0;
  if (s < HAZARD_FREE_UNTIL) return 0;
  const reach = hazardReach(halfWidth);
  const absU = Math.abs(u);
  if (absU > reach + HAZARD_EDGE) return 0;
  const cellU = holeCellIndex(u), cellS = holeCellIndex(s);
  let best = 0, bestKind = 0;
  for (let ds = -NEIGHBOURS; ds <= NEIGHBOURS; ds++) {
    for (let du = -NEIGHBOURS; du <= NEIGHBOURS; du++) {
      if (!holeInCell(cellU + du, cellS + ds, disc)) continue;
      const inside = smoothstep(disc.radius, disc.radius - HAZARD_EDGE, Math.hypot(u - disc.u, s - disc.s));
      if (inside > best) { best = inside; bestKind = disc.kind; }
    }
  }
  if (best === 0) return 0;
  // Holes stop at the barrier, fading over the last HAZARD_EDGE.
  const depth = best * (1 - laneShelter(u, s)) * (1 - smoothstep(reach, reach + HAZARD_EDGE, absU));
  if (depth === 0) return 0;
  out.depth = depth;
  out.kind = bestKind;
  return depth;
}
