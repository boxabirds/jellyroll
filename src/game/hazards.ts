/**
 * The holes: patches of ground that hurt the jelly, a pure function of position
 * like the rest of the world. A hole is a disc in valley coordinates (u across,
 * s along), one per grid cell at most. Three clear lanes run down the valley, so
 * however big and joined-up the holes get there are always three ways through.
 * Holes also cover the banks up to the ridge barrier, so riding up the wall is
 * no way round them.
 */
import { BIOME_LENGTH, CAVE, DUNES, ICE, LAVA, MEADOW, dominantBiome } from './biomes.ts';
import { hash2, smoothstep } from './noise.ts';
import {
  HAZARD_BANK_OVERRUN,
  HAZARD_CELL,
  HAZARD_CHANCE_END,
  HAZARD_CHANCE_START,
  HAZARD_EDGE,
  HAZARD_EDGE_WAVES,
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
  /** The hole this point is mostly in: its grid cell and its disc in valley coordinates. */
  cellI: number; cellJ: number; centreU: number; centreS: number; radius: number; seed: number;
  /** How far into it the point is (0..1), before the lanes and the barrier are allowed for, and the factor for those (0..1). */
  inside: number; factor: number;
  /** The next strongest hole the point is in, if any (inside2 is 0 if none): the ground blends between the two so it never jumps. */
  kind2: number; cellI2: number; cellJ2: number; centreU2: number; centreS2: number; radius2: number; seed2: number; inside2: number;
};

export function createHazardSample(): HazardSample {
  return { depth: 0, kind: 0, cellI: 0, cellJ: 0, centreU: 0, centreS: 0, radius: 0, seed: 0, inside: 0, factor: 0, kind2: 0, cellI2: 0, cellJ2: 0, centreU2: 0, centreS2: 0, radius2: 0, seed2: 0, inside2: 0 };
}

/**
 * Debug: biomes' worth of growth added to (or taken from) the holes wherever the jelly is. Zero in play.
 * Anything that remembers what the holes were is told to forget (see onHazardsChanged).
 */
let levelBias = 0;
const changeListeners: Array<() => void> = [];

export function hazardLevelBias(): number {
  return levelBias;
}

export function setHazardLevelBias(bias: number): void {
  levelBias = bias;
  cacheState.fill(NO_ENTRY);
  for (const listener of changeListeners) listener();
}

export function onHazardsChanged(listener: () => void): void {
  changeListeners.push(listener);
}

/** 0 at the start of the run, rising toward 1 as biomes go by: how big and how many the holes have got. */
export function hazardShape(s: number): number {
  const passed = Math.max(0, s - HAZARD_FREE_UNTIL) / BIOME_LENGTH + levelBias;
  return 1 - Math.exp(-Math.max(0, passed) / HAZARD_GROWTH_BIOMES);
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

/** Ponds, oases, the icy water the shards stand in, and lava are liquids, which lie flat; vents are not. */
export function isLiquidKind(kind: number): boolean {
  return kind === MEADOW || kind === ICE || kind === DUNES || kind === LAVA || kind === CAVE;
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

/** How freely holes act at valley position (`u`, `s`): 0 inside a lane, easing to 1 beyond it, and fading out at the ridge barrier. */
export function hazardFactor(u: number, s: number, halfWidth: number): number {
  return (1 - laneShelter(u, s)) * (1 - smoothstep(hazardReach(halfWidth), hazardReach(halfWidth) + HAZARD_EDGE, Math.abs(u)));
}

/**
 * Depth of the hole at valley position (`u` across from the centre line, `s` along) where the
 * valley is `halfWidth` wide; the hole's kind goes into `out`. Returns the depth.
 */
/** How far into a hole the point (u, s) is: 0 outside its ragged rim, easing up to 1 a little inside it. */
export function insideOf(hole: HoleDisc, u: number, s: number): number {
  const du = u - hole.u, ds = s - hole.s;
  const distance = Math.sqrt(du * du + ds * ds);
  if (distance >= hole.radius * MAX_EDGE_FACTOR) return 0;
  return smoothstep(edgeRadius(hole.radius, hole.seed, Math.atan2(ds, du)), edgeRadius(hole.radius, hole.seed, Math.atan2(ds, du)) - HAZARD_EDGE, distance);
}

/** The most a hole's edge can stand out beyond its nominal radius, as a factor. */
const MAX_EDGE_FACTOR = 1 + HAZARD_EDGE_WAVES[0] + HAZARD_EDGE_WAVES[1] + HAZARD_EDGE_WAVES[2];

/**
 * Where the edge of a hole of nominal `radius` is, in direction `angle` from its centre: each hole's own
 * irregular outline, from its `seed`.
 */
export function edgeRadius(radius: number, seed: number, angle: number): number {
  const phase = seed * TAU;
  return radius * (1
    + HAZARD_EDGE_WAVES[0] * Math.sin(2 * angle + phase)
    + HAZARD_EDGE_WAVES[1] * Math.sin(3 * angle + phase * 2.3 + 1.7)
    + HAZARD_EDGE_WAVES[2] * Math.sin(5 * angle + phase * 3.7 + 0.4));
}

export function hazardAt(u: number, s: number, halfWidth: number, out: HazardSample): number {
  out.depth = 0; out.inside = 0; out.inside2 = 0;
  if (s < HAZARD_FREE_UNTIL) return 0;
  const reach = hazardReach(halfWidth);
  const absU = Math.abs(u);
  if (absU > reach + HAZARD_EDGE) return 0;
  const cellU = holeCellIndex(u), cellS = holeCellIndex(s);
  let best = 0, bestKind = 0, bestI = 0, bestJ = 0, bestU = 0, bestS = 0, bestRadius = 0, bestSeed = 0;
  let second = 0, secondKind = 0, secondI = 0, secondJ = 0, secondU = 0, secondS = 0, secondRadius = 0, secondSeed = 0;
  for (let ds = -NEIGHBOURS; ds <= NEIGHBOURS; ds++) {
    for (let du = -NEIGHBOURS; du <= NEIGHBOURS; du++) {
      if (!holeInCell(cellU + du, cellS + ds, disc)) continue;
      const inside = insideOf(disc, u, s);
      if (inside > best) {
        second = best; secondKind = bestKind; secondI = bestI; secondJ = bestJ; secondU = bestU; secondS = bestS; secondRadius = bestRadius; secondSeed = bestSeed;
        best = inside; bestKind = disc.kind; bestI = cellU + du; bestJ = cellS + ds; bestU = disc.u; bestS = disc.s; bestRadius = disc.radius; bestSeed = disc.seed;
      } else if (inside > second) {
        second = inside; secondKind = disc.kind; secondI = cellU + du; secondJ = cellS + ds; secondU = disc.u; secondS = disc.s; secondRadius = disc.radius; secondSeed = disc.seed;
      }
    }
  }
  if (best === 0) return 0;
  // Holes stop at the barrier, fading over the last HAZARD_EDGE.
  const factor = (1 - laneShelter(u, s)) * (1 - smoothstep(reach, reach + HAZARD_EDGE, absU));
  const depth = best * factor;
  if (depth === 0) return 0;
  out.depth = depth;
  out.kind = bestKind;
  out.cellI = bestI; out.cellJ = bestJ; out.centreU = bestU; out.centreS = bestS; out.radius = bestRadius; out.seed = bestSeed;
  out.inside = best; out.factor = factor;
  out.kind2 = secondKind; out.cellI2 = secondI; out.cellJ2 = secondJ; out.centreU2 = secondU; out.centreS2 = secondS; out.radius2 = secondRadius; out.seed2 = secondSeed; out.inside2 = second;
  return depth;
}
