/**
 * The endless hill as a pure function of position. The jelly travels toward
 * -Z; `s = -z` is the distance travelled down the course. Physics, the chunk
 * meshes and rock placement all sample this one function, so nothing can
 * disagree about where the ground is.
 */
import { frostAt, frozenHeight } from './frost-store.ts';
import { caveDepth, hillScale, mogulScale, widthScale } from './biomes.ts';
import { createHazardSample, createHoleDisc, edgeRadius, hazardAt, hazardFactor, hazardReach, holeCellIndex, holeInCell, isLiquidKind, onHazardsChanged, type HazardSample, type HoleDisc } from './hazards.ts';
import { hash2, smoothstep, valueNoise1, valueNoise2 } from './noise.ts';
import {
  BOWL_CURVATURE,
  GRADIENT_STEP,
  GROOVE_AMPLITUDE,
  GROOVE_LENGTH,
  GROOVE_WIDTH,
  HAZARD_DEPTH,
  HAZARD_CELL,
  HAZARD_CUT_MAX,
  HAZARD_CUT_TAIL,
  HAZARD_EDGE,
  HAZARD_EDGE_WAVES,
  HAZARD_FREE_UNTIL,
  HAZARD_POOL_DEPTH,
  HAZARD_WALL_FRACTION,
  HAZARD_WALL_SLOPE,
  CAVE_HILL_RISE,
  CAVE_PORTAL,
  CAVE_WALL_FROM,
  CAVE_WALL_TO,
  HAZARD_RIM_MARGINS,
  HAZARD_RIM_SAMPLES,
  HAZARD_WET_FADE,
  HILL_AMPLITUDE,
  HILL_WAVELENGTH,
  KICKER_CHANCE,
  KICKER_CORE_FRACTION,
  KICKER_FALLOFF,
  KICKER_FIRST_SEGMENT,
  KICKER_HALF_WIDTH,
  KICKER_HEIGHT,
  KICKER_LATERAL_FRACTION,
  KICKER_LENGTH,
  KICKER_MARGIN,
  KICKER_SPACING,
  KNOLL_AMPLITUDE,
  KNOLL_WAVELENGTH,
  MEAN_SLOPE,
  MEANDER_WAVES,
  MOGUL_AMPLITUDE,
  MOGUL_WAVELENGTH,
  RIPPLE_AMPLITUDE,
  ROLLER_AMPLITUDE,
  ROLLER_SKEW_WAVELENGTH,
  ROLLER_WAVELENGTH,
  RIPPLE_WAVELENGTH,
  ROUGHNESS_WAVELENGTH,
  SLOPE_WAVES,
  START_SMOOTH_FROM,
  START_SMOOTH_TO,
  VALLEY_HALF_WIDTH,
  VALLEY_HALF_WIDTH_SWING,
  RIDGE_BACK_FRACTION,
  RIDGE_DISTANCE,
  RIDGE_HEIGHT,
  VALLEY_WIDTH_WAVELENGTH,
  WORLD_SEED,
} from './tuning.ts';

const TAU = Math.PI * 2;
const holeScratch = createHazardSample();
const SEED_HILLS = WORLD_SEED + 1;
const SEED_MOGULS = WORLD_SEED + 2;
const SEED_RIPPLE = WORLD_SEED + 3;
const SEED_ROUGHNESS = WORLD_SEED + 4;
const SEED_KICKER_EXISTS = WORLD_SEED + 5;
const SEED_KICKER_ALONG = WORLD_SEED + 6;
const SEED_KICKER_ACROSS = WORLD_SEED + 7;
const SEED_ROLLERS = WORLD_SEED + 8;
const SEED_KNOLLS = WORLD_SEED + 9;
const SEED_GROOVES = WORLD_SEED + 10;

export type Vec3Like = { x: number; y: number; z: number };

/** X of the valley centre line at course distance `s`. */
export function courseCenter(s: number): number {
  let x = 0;
  for (const wave of MEANDER_WAVES) x += wave.amplitude * Math.sin((s * TAU) / wave.wavelength + wave.phase);
  return x;
}

/** d(courseCenter)/ds: how fast the valley is drifting sideways. */
export function courseDrift(s: number): number {
  let slope = 0;
  for (const wave of MEANDER_WAVES) {
    const k = TAU / wave.wavelength;
    slope += wave.amplitude * k * Math.cos(s * k + wave.phase);
  }
  return slope;
}

export function courseHalfWidth(s: number): number {
  return (VALLEY_HALF_WIDTH + VALLEY_HALF_WIDTH_SWING * Math.sin((s * TAU) / VALLEY_WIDTH_WAVELENGTH)) * widthScale(s);
}

/** 0 on glassy stretches, rising on rough ones; the biome scales how rough "rough" gets. */
export function courseRoughness(s: number): number {
  const rough = valueNoise1(s / ROUGHNESS_WAVELENGTH, SEED_ROUGHNESS);
  return rough * rough * smoothstep(START_SMOOTH_FROM, START_SMOOTH_TO, s) * mogulScale(s);
}

/** Height of the valley bank `beyond` metres outside the valley half width. */
function bankHeight(beyond: number): number {
  if (beyond <= 0) return 0;
  const phase = Math.PI * Math.min(beyond / RIDGE_DISTANCE, RIDGE_BACK_FRACTION);
  return (RIDGE_HEIGHT * (1 - Math.cos(phase))) / 2;
}

function descent(s: number): number {
  let y = -MEAN_SLOPE * s;
  for (const wave of SLOPE_WAVES) y += wave.amplitude * Math.sin((s * TAU) / wave.wavelength + wave.phase);
  return y;
}

/** Height added by the launch ramp (if any) of the segment containing `s`. */
export function kickerHeight(x: number, s: number): number {
  const segment = Math.floor(s / KICKER_SPACING);
  if (segment < KICKER_FIRST_SEGMENT) return 0;
  if (hash2(segment, 0, SEED_KICKER_EXISTS) > KICKER_CHANCE) return 0;
  const usable = KICKER_SPACING - 2 * KICKER_MARGIN - KICKER_LENGTH - KICKER_FALLOFF;
  const start = segment * KICKER_SPACING + KICKER_MARGIN + hash2(segment, 0, SEED_KICKER_ALONG) * usable;
  const along = s - start;
  if (along <= 0 || along >= KICKER_LENGTH + KICKER_FALLOFF) return 0;
  const lateralRange = courseHalfWidth(start) * KICKER_LATERAL_FRACTION;
  const centre = courseCenter(start) + (hash2(segment, 0, SEED_KICKER_ACROSS) * 2 - 1) * lateralRange;
  const across = Math.abs(x - centre);
  if (across >= KICKER_HALF_WIDTH) return 0;
  const lateral = 1 - smoothstep(KICKER_HALF_WIDTH * KICKER_CORE_FRACTION, KICKER_HALF_WIDTH, across);
  let profile: number;
  if (along < KICKER_LENGTH) {
    const t = along / KICKER_LENGTH;
    profile = t * t;
  } else {
    profile = 1 - smoothstep(0, 1, (along - KICKER_LENGTH) / KICKER_FALLOFF);
  }
  return KICKER_HEIGHT * profile * lateral;
}

/** The ground without any holes in it. */
function groundHeight(x: number, s: number, offset: number, halfWidth: number): number {
  const u = Math.abs(offset);
  const beyond = u - halfWidth;
  // Past the ridge the land is distant scenery drawn with very coarse cells:
  // the bowl stops climbing and fine relief fades out, leaving broad hills.
  const bowlReach = Math.min(u, halfWidth + RIDGE_DISTANCE);
  const inValley = 1 - smoothstep(0, RIDGE_DISTANCE, beyond);
  const rough = courseRoughness(s) * inValley;
  const hills = hillScale(s);
  return (
    descent(s) +
    BOWL_CURVATURE * bowlReach * bowlReach +
    bankHeight(beyond) +
    HILL_AMPLITUDE * hills * valueNoise2(x / HILL_WAVELENGTH, s / HILL_WAVELENGTH, SEED_HILLS) +
    ROLLER_AMPLITUDE * hills * inValley * valueNoise2(x / ROLLER_SKEW_WAVELENGTH, s / ROLLER_WAVELENGTH, SEED_ROLLERS) +
    KNOLL_AMPLITUDE * inValley * valueNoise2(x / KNOLL_WAVELENGTH, s / KNOLL_WAVELENGTH, SEED_KNOLLS) +
    GROOVE_AMPLITUDE * inValley * valueNoise2(x / GROOVE_WIDTH, s / GROOVE_LENGTH, SEED_GROOVES) +
    MOGUL_AMPLITUDE * rough * valueNoise2(x / MOGUL_WAVELENGTH, s / MOGUL_WAVELENGTH, SEED_MOGULS) +
    RIPPLE_AMPLITUDE * rough * valueNoise2(x / RIPPLE_WAVELENGTH, s / RIPPLE_WAVELENGTH, SEED_RIPPLE) +
    kickerHeight(x, s) +
    caveHill(u, s, halfWidth)
  );
}

/** The hill the cave runs through: how much the banks are raised at `u` metres from the centre line (see CAVE_HILL_RISE). */
function caveHill(u: number, s: number, halfWidth: number): number {
  const depth = caveDepth(s);
  if (depth <= 0 || u <= halfWidth + CAVE_WALL_FROM) return 0;
  return CAVE_HILL_RISE * smoothstep(0, CAVE_PORTAL, depth) * smoothstep(halfWidth + CAVE_WALL_FROM, halfWidth + CAVE_WALL_TO, u);
}

/** Stands in for the water level of a hole that is not water: above anything, so the whole hole counts as wet. */
export const NO_WATER_LEVEL = 1e6;

const LEVEL_SLOTS = 2048;
const LEVEL_MASK = LEVEL_SLOTS - 1;
const levelI = new Int32Array(LEVEL_SLOTS);
const levelJ = new Int32Array(LEVEL_SLOTS);
const levelKnown = new Uint8Array(LEVEL_SLOTS);
const levelValue = new Float64Array(LEVEL_SLOTS);
onHazardsChanged(() => levelKnown.fill(0));
const cellDisc = createHoleDisc();

/**
 * The surface of the liquid hole at cell (`cellI`, `cellJ`): the lowest point of its rim, where it would spill. A rim
 * whose far side drops away within a metre or two is not a rim at all, so the lowest ground both on the rim and just
 * outside it counts, found round the whole outline finely enough not to step over a notch. Remembered per hole, since every nearby height sample asks.
 */
function surfaceOf(cellI: number, cellJ: number, centreU: number, centreS: number, radius: number, seed: number): number {
  const slot = ((Math.imul(cellI, 73856093) ^ Math.imul(cellJ, 19349663)) >>> 0) & LEVEL_MASK;
  if (levelKnown[slot] && levelI[slot] === cellI && levelJ[slot] === cellJ) return levelValue[slot];
  let lowest = Infinity;
  for (let k = 0; k < HAZARD_RIM_SAMPLES; k++) {
    const angle = (k / HAZARD_RIM_SAMPLES) * TAU;
    const rim = edgeRadius(radius, seed, angle);
    for (const margin of HAZARD_RIM_MARGINS) {
      const reach = rim + margin;
      const s = centreS + Math.sin(angle) * reach;
      const offset = centreU + Math.cos(angle) * reach;
      lowest = Math.min(lowest, groundHeight(courseCenter(s) + offset, s, offset, courseHalfWidth(s)));
    }
  }
  levelI[slot] = cellI; levelJ[slot] = cellJ; levelKnown[slot] = 1; levelValue[slot] = lowest;
  return lowest;
}

/** Height of the surface of the liquid hole at grid cell (`cellI`, `cellJ`) whose disc is `disc`. */
export function discLevel(cellI: number, cellJ: number, disc: HoleDisc): number {
  return surfaceOf(cellI, cellJ, disc.u, disc.s, disc.radius, disc.seed);
}

/** Height of the surface of the liquid hole `hole` was sampled in, or NO_WATER_LEVEL if it is not a liquid. */
export function holeLevel(hole: HazardSample): number {
  if (!isLiquidKind(hole.kind)) return NO_WATER_LEVEL;
  return surfaceOf(hole.cellI, hole.cellJ, hole.centreU, hole.centreS, hole.radius, hole.seed);
}

/** Grid cells searched round a point for basins that cut there: the reach (HAZARD_RADIUS_END x edge waves + tail) is at most two cells. */
const CUT_NEIGHBOURS = 2;

/** The most a hole's cut reaches beyond its nominal radius. */
const MAX_REACH = 1 + HAZARD_EDGE_WAVES[0] + HAZARD_EDGE_WAVES[1] + HAZARD_EDGE_WAVES[2];

/** Within this fraction of a hole's nominal radius from its centre the floor is flat in every direction (the rim is at least 1 - the edge waves, and the wall takes the larger of 30% of it and a minimum). */
const MIN_FLOOR = (1 - HAZARD_EDGE_WAVES[0] - HAZARD_EDGE_WAVES[1] - HAZARD_EDGE_WAVES[2]) * (1 - HAZARD_WALL_FRACTION) - 0.5;

/** How far below `ground` a liquid basin cuts at (offset, s): 0 if it does not reach there. `floor` is the basin's flat floor. */
function cutOf(centreU: number, centreS: number, radius: number, seed: number, floor: number, offset: number, s: number, ground: number): number {
  const du = offset - centreU, ds = s - centreS;
  // (Math.sqrt rather than Math.hypot: this runs for every basin near every height sample, and hypot is slow.)
  const distance = Math.sqrt(du * du + ds * ds);
  if (distance >= radius * MAX_REACH + HAZARD_CUT_TAIL) return 0;
  // Well inside, whatever the ragged rim does, it is the flat floor: no need to find the direction.
  if (distance <= radius * MIN_FLOOR) return Math.min(HAZARD_CUT_MAX, Math.max(0, ground - floor));
  const rim = edgeRadius(radius, seed, Math.atan2(ds, du));
  if (distance >= rim + HAZARD_CUT_TAIL) return 0;
  // The flat floor, then walls climbing at a fixed slope; the floor extends from the middle out to a wall wide enough to rise above the surface.
  const wall = Math.max(HAZARD_WALL_FRACTION * rim, HAZARD_POOL_DEPTH / HAZARD_WALL_SLOPE + 0.2);
  const cone = floor + HAZARD_WALL_SLOPE * Math.max(0, distance - (rim - wall));
  const fade = distance <= rim ? 1 : 1 - smoothstep(0, HAZARD_CUT_TAIL, distance - rim);
  return Math.min(HAZARD_CUT_MAX, Math.max(0, ground - cone)) * fade;
}

/**
 * The liquid basins that can reach a stretch of the course, collected once so that the many height samples of
 * one terrain chunk each check a short list instead of searching the grid.
 */
export class HoleSet {
  static readonly CAPACITY = 1024;
  count = 0;
  /** True if any hole of another kind (a steam vent) is near, so the ground needs its dip too. */
  vents = false;
  readonly u = new Float64Array(HoleSet.CAPACITY);
  readonly s = new Float64Array(HoleSet.CAPACITY);
  readonly radius = new Float64Array(HoleSet.CAPACITY);
  readonly seed = new Float64Array(HoleSet.CAPACITY);
  readonly floor = new Float64Array(HoleSet.CAPACITY);
  /** How far from its centre each basin's cut can reach (metres). */
  readonly reach = new Float64Array(HoleSet.CAPACITY);
}

/** Fill `set` with every liquid basin whose cut can reach course distances `sFrom` to `sTo`. */
export function collectHoles(set: HoleSet, sFrom: number, sTo: number): void {
  set.count = 0; set.vents = false;
  if (sTo < HAZARD_FREE_UNTIL - HAZARD_CUT_TAIL) return;
  const cellFrom = holeCellIndex(sFrom) - CUT_NEIGHBOURS, cellTo = holeCellIndex(sTo) + CUT_NEIGHBOURS;
  const across = Math.ceil((VALLEY_HALF_WIDTH + VALLEY_HALF_WIDTH_SWING + RIDGE_DISTANCE + HAZARD_CUT_TAIL) / HAZARD_CELL) + CUT_NEIGHBOURS + 1;
  for (let j = cellFrom; j <= cellTo; j++) {
    for (let i = -across; i <= across; i++) {
      if (set.count === HoleSet.CAPACITY || !holeInCell(i, j, cellDisc)) continue;
      if (!isLiquidKind(cellDisc.kind)) { set.vents = true; continue; }
      const n = set.count++;
      set.u[n] = cellDisc.u; set.s[n] = cellDisc.s; set.radius[n] = cellDisc.radius; set.seed[n] = cellDisc.seed;
      set.reach[n] = cellDisc.radius * MAX_REACH + HAZARD_CUT_TAIL;
      set.floor[n] = surfaceOf(i, j, cellDisc.u, cellDisc.s, cellDisc.radius, cellDisc.seed) - HAZARD_POOL_DEPTH;
    }
  }
}

/** Ground height with the dip of vents and the cuts of the liquid basins in `set` (see collectHoles); the same as terrainHeight over the stretch it was collected for. */
export function terrainHeightWith(set: HoleSet, x: number, z: number): number {
  const s = -z;
  const offset = x - courseCenter(s);
  const halfWidth = courseHalfWidth(s);
  const ground = groundHeight(x, s, offset, halfWidth);
  if (s < HAZARD_FREE_UNTIL || Math.abs(offset) > hazardReach(halfWidth) + HAZARD_EDGE) return ground;
  let cut = 0;
  for (let n = 0; n < set.count; n++) {
    const reach = set.reach[n];
    if (Math.abs(s - set.s[n]) >= reach || Math.abs(offset - set.u[n]) >= reach) continue;
    cut = Math.max(cut, cutOf(set.u[n], set.s[n], set.radius[n], set.seed[n], set.floor[n], offset, s, ground));
  }
  if (cut === 0 && !set.vents) return ground;
  return frozenHeight(x, z, shaped(ground, cut, offset, s, halfWidth));
}

/** Keep in `to` only the basins of `from` that can reach course distance `s` (and a metre either side), for filling one row of a chunk. */
export function narrowToRow(from: HoleSet, to: HoleSet, s: number): void {
  to.count = 0; to.vents = from.vents;
  for (let n = 0; n < from.count; n++) {
    if (Math.abs(s - from.s[n]) >= from.reach[n] + 1) continue;
    const m = to.count++;
    to.u[m] = from.u[n]; to.s[m] = from.s[n]; to.radius[m] = from.radius[n]; to.seed[m] = from.seed[n]; to.floor[m] = from.floor[n]; to.reach[m] = from.reach[n];
  }
}

/** The ground with a liquid cut and the dip of any vent applied. */
function shaped(ground: number, cut: number, offset: number, s: number, halfWidth: number): number {
  let height = cut > 0 ? ground - cut * hazardFactor(offset, s, halfWidth) : ground;
  // The other holes (steam vents) are a simple dip.
  const depth = hazardAt(offset, s, halfWidth, holeScratch);
  if (depth > 0 && !isLiquidKind(holeScratch.kind)) height -= HAZARD_DEPTH * depth;
  return height;
}

export function terrainHeight(x: number, z: number): number {
  const s = -z;
  const offset = x - courseCenter(s);
  const halfWidth = courseHalfWidth(s);
  const ground = groundHeight(x, s, offset, halfWidth);
  if (s < HAZARD_FREE_UNTIL || Math.abs(offset) > hazardReach(halfWidth) + HAZARD_EDGE) return ground;
  // Every liquid basin near here cuts the ground; the deepest cut wins, so overlapping pools join. The lanes and the barrier hold it back.
  // A cut reaches up to a ragged radius plus its tail from its hole's centre, which can be two cells away.
  const cellU = holeCellIndex(offset), cellS = holeCellIndex(s);
  let cut = 0;
  for (let ds = -CUT_NEIGHBOURS; ds <= CUT_NEIGHBOURS; ds++) {
    for (let du = -CUT_NEIGHBOURS; du <= CUT_NEIGHBOURS; du++) {
      if (!holeInCell(cellU + du, cellS + ds, cellDisc) || !isLiquidKind(cellDisc.kind)) continue;
      const floor = surfaceOf(cellU + du, cellS + ds, cellDisc.u, cellDisc.s, cellDisc.radius, cellDisc.seed) - HAZARD_POOL_DEPTH;
      cut = Math.max(cut, cutOf(cellDisc.u, cellDisc.s, cellDisc.radius, cellDisc.seed, floor, offset, s, ground));
    }
  }
  return frozenHeight(x, z, shaped(ground, cut, offset, s, halfWidth));
}

/**
 * How much of a hole the point (x, z) is in, counting only what is hurting: a point in a pond but on
 * dry ground above its water is not in the hole. `out` gets the hole's depth and kind as in hazardAt.
 */
export function holeEffectAt(x: number, z: number, out: HazardSample): number {
  const s = -z;
  const depth = hazardAt(x - courseCenter(s), s, courseHalfWidth(s), out);
  if (depth === 0 || !isLiquidKind(out.kind)) return depth;
  // Water the freeze ray has frozen, or lava it has cooled, is not there any more as far as the jelly is concerned.
  if (frostAt(x, z)) return 0;
  const wet = Math.min(1, Math.max(0, (holeLevel(out) - terrainHeight(x, z)) / HAZARD_WET_FADE));
  return depth * wet;
}

/** Unit surface normal at (x, z), written into `out`. Returns the height there. */
export function terrainNormal(x: number, z: number, out: Vec3Like): number {
  const h = terrainHeight(x, z);
  const dhdx = (terrainHeight(x + GRADIENT_STEP, z) - h) / GRADIENT_STEP;
  const dhdz = (terrainHeight(x, z + GRADIENT_STEP) - h) / GRADIENT_STEP;
  const inverseLength = 1 / Math.hypot(dhdx, 1, dhdz);
  out.x = -dhdx * inverseLength;
  out.y = inverseLength;
  out.z = -dhdz * inverseLength;
  return h;
}
