/**
 * Rigid rolling-ball simulation over the terrain function. Pure and
 * allocation-free per step: all scratch state lives in module scope or on the
 * ball itself. The jelly wobble is layered on top in wobble.ts.
 */
import { mushroomCellIndex, mushroomInCell, createMushroom, createMushroomLedger, isMushroomTaken, resetMushroomLedger, takeMushroom, type MushroomLedger } from './mushrooms.ts';
import { caveAt, snowAt, speedScale, steerScale, wearScale } from './biomes.ts';
import { createSpike, spikeCellIndex, stalactiteInCell, stalagmiteInCell } from './spikes.ts';
import { createHazardSample, hazardShape, isLiquidKind, onHazardsChanged, type HazardSample } from './hazards.ts';
import { createMagnet, magnetInSegment, magnetSegment } from './magnets.ts';
import { addBee, createFlock, resetFlock, stepFlock, type Flock, type Item } from './bees.ts';
import { createSpot, pickupInSegment, pickupSegment } from './pickups.ts';
import { BEE_PICKUP, GLASS_PICKUP } from './pickup-kinds.ts';
import { createShieldCounts, shieldFactorAt, shieldLevel } from './progression.ts';
import { createSeedPacket, seedPacketInSegment, seedPacketSegment } from './seed-packets.ts';
import { advanceSeeds, clearSeeds, createSeedField, plantSeeds, sproutScale, type SeedField } from './seeds.ts';
import { clamp } from './noise.ts';
import { breakRock, createRock, createRockLedger, isRockBroken, resetRockLedger, rockCellIndex, rockInCell, type RockLedger } from './rocks.ts';
import { courseCenter, courseDrift, courseHalfWidth, holeEffectAt, holeLevel, terrainHeight, terrainNormal } from './terrain.ts';
import {
  AIR_CONTROL,
  BEE_MAX,
  BEE_PICKUP_RADIUS,
  GLASS_BREAK_KEEP,
  HAZARD_FREE_UNTIL,
  MAX_FALLERS,
  MAX_SPIKE_EVENTS,
  STALACTITE_DAMAGE,
  STALACTITE_HIT_KEEP,
  STALACTITE_HIT_MARGIN,
  STALACTITE_LEAD,
  STALACTITE_SCAN_SECONDS,
  STALACTITE_TRIGGER_MAX,
  STALACTITE_TRIGGER_MIN,
  STALAGMITE_POST_HEIGHT,
  STALAGMITE_POST_RADIUS,
  STALAGMITE_RESTITUTION,
  POWERUP_GLASS,
  POWERUP_MAGNET,
  POWERUP_SEEDS,
  POWERUP_SLOTS,
  STOCK_MAX,
  SPIKE_CELL,
  GLASS_PICKUP_RADIUS,
  MAX_BROKEN_PER_STEP,
  GLASS_SECONDS,
  MUSHROOM_CELL,
  MUSHROOM_TOUCH,
  BOOST_ACCEL,
  BOUNCE_MIN_IMPACT,
  BRAKE_ACCEL,
  BRAKE_FADE_RANGE,
  DRAG,
  TUCKED_DRAG,
  TUCK_FALL_RATE,
  TUCK_RISE_RATE,
  GRAVITY,
  GROUND_CONTACT_SLOP,
  GLASS_WEIGHT,
  GROUND_RESTITUTION,
  HAZARD_EFFECTS,
  HAZARD_HARDER_GAIN,
  HAZARD_STAB_KEEP,
  HAZARD_STAB_SPACING,
  HAZARD_VENT_DUTY,
  HAZARD_VENT_HEIGHT,
  HAZARD_VENT_PHASE_PER_METRE,
  HAZARD_VENT_RATE,
  HEADING_MIN_SPEED,
  MAGNET_PICKUP_RADIUS,
  SEED_PACKET_PICKUP_RADIUS,
  MAGNET_RADIUS,
  MAGNET_SECONDS,
  JUMP_BUFFER_SECONDS,
  JUMP_COYOTE_SECONDS,
  JUMP_SPEED,
  MAX_PICKUPS_PER_STEP,
  MAX_RADIUS,
  MAX_SPEED,
  MIN_RADIUS,
  MIN_SPEED,
  NUDGE_ACCEL,
  ROCK_RESTITUTION,
  ROCK_SLIDE_ACCEL,
  RIDGE_BARRIER_INSET,
  RIDGE_BARRIER_RESTITUTION,
  RIDGE_DISTANCE,
  ROCK_FRICTION,
  SPIN_FOLLOW_RATE,
  START_RADIUS,
  STEER_ACCEL,
  STEER_REFERENCE_SPEED,
  SNOW_FULL_METRES,
  SNOW_MELT_RATE,
  SNOW_SCRAPE_RATE,
  SNOW_SHED_RATE,
  SNOW_SHED_SPEED_FACTOR,
  SNOW_STEER_LOSS,
  SNOW_WEAR_PROTECTION,
  WEAR_PER_METRE,
  WEAR_PER_METRE_PER_RADIUS,
} from './tuning.ts';

/** throttle: +1 accelerate (W), -1 decelerate (S). steer: -1 left (A), +1 right (D). jump: Space held. */
export type ControlInput = { throttle: number; steer: number; jump?: boolean };

/** A mushroom absorbed during the last step, for the visuals to melt into the jelly. */
export type Pickup = {
  /** Unit direction from the jelly's centre to the mushroom, world axes, and how far away it was. */
  dx: number; dy: number; dz: number; distance: number;
  /** The jelly's radius just before this merge, and the volume the merge added to it. */
  jellyRadius: number; volume: number;
  radius: number; kind: number; look: number; color: number; color2: number; seed: number;
};

export type Ball = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Current size: worn down by rolling, built up by merging. */
  radius: number;
  /** True once worn below MIN_RADIUS; the simulation then holds still. */
  wornOut: boolean;
  /** Ground normal under the ball (valid whether or not it is touching). */
  nx: number; ny: number; nz: number;
  grounded: boolean;
  /** Angular velocity, rad/s. */
  wx: number; wy: number; wz: number;
  /** Orientation quaternion accumulated from rolling. */
  qx: number; qy: number; qz: number; qw: number;
  /** Largest into-surface speed absorbed during the last step (0 if none). */
  impact: number;
  /** Speed at which a rock was struck during the last step (0 if none). */
  rockImpact: number;
  /** True on the step a jump launched. */
  jumped: boolean;
  /** Farthest course distance reached: the main score. */
  distance: number;
  /** Total seconds spent off the ground this run: the "air time" score. */
  airSeconds: number;
  /** Seconds since last touching the ground, and since jump was last pressed. */
  airTime: number; jumpQueued: number; jumpHeld: boolean;
  /** 0..1: how far W has eased the air drag down toward TUCKED_DRAG. */
  tuck: number;
  /** 0..1: how much snow the jelly has packed on (Ice biome): it protects against wear and costs steering. */
  snow: number;
  /** Seconds the run has lasted (drives the pulsing of steam vents). */
  clock: number;
  /** The hole under the jelly: how deep in it (0 outside) and of what kind (a biome index). */
  hazardDepth: number; hazardKind: number;
  /** Height of the liquid surface the jelly is in, or NaN when it is not in a liquid. */
  hazardLevel: number;
  /** Shards that tore a piece off during the last step, and whether a vent threw the jelly this step. */
  stabs: number; vented: boolean;
  /** Metres rolled through shards since the last stab, and whether a vent is lifting the jelly now. */
  stabMetres: number; venting: boolean;
  /** Mushrooms absorbed during the last step: the first `pickupCount` entries are valid. */
  pickups: Pickup[]; pickupCount: number;
  /** Mushrooms absorbed this run. */
  merges: number;
  /** Seconds of magnet left; 0 when it is off. */
  magnetSeconds: number;
  /** True on the step a magnet was picked up. */
  magnetPicked: boolean;
  /** Slots whose key was pressed since the last step: used at the start of the next, so what they do is seen and heard in that step. */
  wanted: number[];
  /** Power-ups carried, by slot (POWERUP_MAGNET, POWERUP_GLASS, POWERUP_SEEDS); the number keys use them. */
  stock: number[];
  /** Stretch of the course whose magnet was last picked up, so it is not there twice. */
  magnetTakenSegment: number;
  /** Seconds of glass marble left; 0 when the jelly is jelly. While it lasts, nothing wears or melts the jelly. */
  glassSeconds: number;
  /** True on the step a glass marble was picked up, and the stretch whose marble was last taken. */
  glassPicked: boolean;
  glassTakenSegment: number;
  /** Collectibles absorbed this run, by kind (the biome they belong to), and the shield level each has reached. */
  shieldCounts: number[];
  shieldLevels: number[];
  /** The kind whose shield levelled up on the last step, or -1. */
  shieldUp: number;
  /** The bees, and the stretch whose bee was last taken; `beePicked` is true on the step one was found. */
  flock: Flock;
  beePicked: boolean;
  beeTakenSegment: number;
  /** Rocks the glass marble has smashed this run, and the ones smashed in the last step (the first `brokenCount` entries): where each was and how big. */
  brokenRocks: RockLedger;
  broken: { x: number; y: number; z: number; radius: number; look: number }[];
  brokenCount: number;
  /** The cave: stalagmites the marble has knocked over and stalactites that have fallen this run (two ledgers of cells). */
  toppledSpikes: RockLedger;
  fallenSpikes: RockLedger;
  /** Stalagmites knocked over in the last step (the first `toppledCount`): where, how big, and which way they were pushed. */
  toppled: SpikeEvent[]; toppledCount: number;
  /** Stalactites that let go in the last step, and that landed (or hit the jelly) in it. */
  cracked: number;
  landed: SpikeEvent[]; landedCount: number;
  /** True on the step a falling stalactite hit the jelly. */
  spikeHit: boolean;
  /** Stalactites on their way down. */
  fallers: Faller[];
  spikeScan: number;
  /** Radius lost to hazards (water, spikes, steam, lava) since the damage numbers last read it (metres). Rolling wear is not counted: it would be noise. */
  lost: number;
  /** True on the step a seed packet was picked up, and the stretch whose packet was last taken. */
  seedsSprayed: boolean;
  /** Set for one step when a seed packet is picked up (for its sound). */
  packetFound: boolean;
  seedTakenSegment: number;
  /** Seeds in flight and the collectibles they have become. */
  seeds: SeedField;
  ledger: MushroomLedger;
};

const START_HEIGHT_CLEARANCE = 0.05;
const NEIGHBOUR_CELLS = 1;
const HALF = 0.5;
/** Sideways offset from a rock's centre line (m) below which the jelly counts as dead centre. */
const ROCK_SLIDE_TIE = 0.05;
/** No piece of a step moves the jelly further than this (metres): less than the smallest mushroom. */
const MAX_TRAVEL_PER_PIECE = 0.3;
/** Cost ceiling, far above what MAX_SPEED needs (0.3 m x 32 x 120 Hz is over 4,000 km/h). */
const MAX_PIECES_PER_STEP = 32;
/** Mushroom cells to search either side: enough to cover the jelly's own radius. */
const MUSHROOM_CELL_REACH_DIVISOR = MUSHROOM_CELL;

const normal = { x: 0, y: 1, z: 0 };
const rock = createRock();
const mushroom = createMushroom();
const magnet = createMagnet();
const seedPacket = createSeedPacket();
const glassSpot = createSpot();
const beeSpot = createSpot();
const NEVER = Number.POSITIVE_INFINITY;
const NO_SEGMENT = -1;

/** A stalagmite knocked over or a stalactite landed: where its base is (or was), its size, and the direction it was pushed. */
export type SpikeEvent = { x: number; y: number; z: number; radius: number; length: number; look: number; dirX: number; dirZ: number };
/** A stalactite falling: its place, the height of its tip now, and its speed downward. */
export type Faller = { active: boolean; x: number; z: number; ground: number; tip: number; vy: number; radius: number; length: number; look: number };
const createSpikeEvent = (): SpikeEvent => ({ x: 0, y: 0, z: 0, radius: 0, length: 0, look: 0, dirX: 0, dirZ: -1 });

export function createBall(): Ball {
  const ball: Ball = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, radius: START_RADIUS, wornOut: false,
    nx: 0, ny: 1, nz: 0, grounded: false,
    wx: 0, wy: 0, wz: 0, qx: 0, qy: 0, qz: 0, qw: 1,
    impact: 0, rockImpact: 0, jumped: false, distance: 0, airSeconds: 0,
    airTime: NEVER, jumpQueued: NEVER, jumpHeld: false, tuck: 0,
    snow: 0, clock: 0, hazardLevel: Number.NaN, hazardDepth: 0, hazardKind: 0, stabs: 0, vented: false, stabMetres: 0, venting: false,
    pickups: Array.from({ length: MAX_PICKUPS_PER_STEP }, () => ({ dx: 0, dy: 1, dz: 0, distance: 0, jellyRadius: 0, volume: 0, radius: 0, kind: 0, look: 0, color: 0, color2: 0, seed: 0 })),
    pickupCount: 0, merges: 0, magnetSeconds: 0, magnetPicked: false, stock: Array.from({ length: POWERUP_SLOTS }, () => 0), wanted: [], magnetTakenSegment: NO_SEGMENT,
    glassSeconds: 0, glassPicked: false, glassTakenSegment: NO_SEGMENT,
    shieldCounts: createShieldCounts(), shieldLevels: createShieldCounts(), shieldUp: -1,
    brokenRocks: createRockLedger(), broken: Array.from({ length: MAX_BROKEN_PER_STEP }, () => ({ x: 0, y: 0, z: 0, radius: 0, look: 0 })), brokenCount: 0,
    toppledSpikes: createRockLedger(), fallenSpikes: createRockLedger(),
    toppled: Array.from({ length: MAX_SPIKE_EVENTS }, createSpikeEvent), toppledCount: 0, cracked: 0,
    landed: Array.from({ length: MAX_SPIKE_EVENTS }, createSpikeEvent), landedCount: 0, spikeHit: false,
    fallers: Array.from({ length: MAX_FALLERS }, () => ({ active: false, x: 0, z: 0, ground: 0, tip: 0, vy: 0, radius: 0, length: 0, look: 0 })), spikeScan: 0,
    flock: createFlock(), beePicked: false, beeTakenSegment: NO_SEGMENT, lost: 0,
    seedsSprayed: false, packetFound: false, seedTakenSegment: NO_SEGMENT, seeds: createSeedField(),
    ledger: createMushroomLedger(),
  };
  resetBall(ball);
  return ball;
}

/** Put the ball back at the top of the course, already rolling. */
export function resetBall(ball: Ball): void {
  ball.radius = START_RADIUS; ball.wornOut = false;
  ball.x = courseCenter(0);
  ball.z = 0;
  ball.y = terrainHeight(ball.x, ball.z) + ball.radius + START_HEIGHT_CLEARANCE;
  ball.vx = 0; ball.vy = 0; ball.vz = -MIN_SPEED;
  ball.nx = 0; ball.ny = 1; ball.nz = 0;
  ball.grounded = false;
  ball.wx = 0; ball.wy = 0; ball.wz = 0;
  ball.qx = 0; ball.qy = 0; ball.qz = 0; ball.qw = 1;
  ball.impact = 0; ball.rockImpact = 0; ball.jumped = false; ball.distance = 0; ball.airSeconds = 0;
  ball.airTime = NEVER; ball.jumpQueued = NEVER; ball.jumpHeld = false; ball.tuck = 0;
  ball.snow = 0; ball.clock = 0; ball.hazardLevel = Number.NaN; ball.hazardDepth = 0; ball.hazardKind = 0; ball.stabs = 0; ball.vented = false; ball.stabMetres = 0; ball.venting = false;
  ball.pickupCount = 0; ball.merges = 0;
  ball.magnetSeconds = 0; ball.magnetPicked = false; ball.magnetTakenSegment = NO_SEGMENT; ball.stock.fill(0); ball.wanted.length = 0;
  ball.seedsSprayed = false; ball.seedTakenSegment = NO_SEGMENT; clearSeeds(ball.seeds);
  ball.glassSeconds = 0; ball.glassPicked = false; ball.glassTakenSegment = NO_SEGMENT;
  ball.shieldCounts.fill(0); ball.shieldLevels.fill(0); ball.shieldUp = -1;
  resetRockLedger(ball.brokenRocks); ball.brokenCount = 0;
  resetRockLedger(ball.toppledSpikes); resetRockLedger(ball.fallenSpikes); ball.toppledCount = 0; ball.landedCount = 0; ball.cracked = 0; ball.spikeHit = false;
  for (const faller of ball.fallers) faller.active = false;
  ball.spikeScan = 0;
  resetFlock(ball.flock); ball.beePicked = false; ball.beeTakenSegment = NO_SEGMENT; ball.lost = 0;
  resetMushroomLedger(ball.ledger);
}

export function ballSpeed(ball: Ball): number {
  return Math.hypot(ball.vx, ball.vy, ball.vz);
}

export function stepBall(ball: Ball, input: ControlInput, dt: number): void {
  ball.impact = 0;
  ball.rockImpact = 0;
  ball.jumped = false;
  ball.pickupCount = 0;
  ball.stabs = 0;
  ball.vented = false;
  ball.magnetPicked = false;
  ball.seedsSprayed = false;
  ball.packetFound = false;
  ball.glassPicked = false;
  ball.brokenCount = 0;
  ball.toppledCount = 0; ball.landedCount = 0; ball.cracked = 0; ball.spikeHit = false;
  ball.beePicked = false;
  ball.shieldUp = -1;
  // A key pressed between steps takes effect here, after the event flags were cleared, so the sound and the messages see it.
  while (ball.wanted.length > 0) usePowerup(ball, ball.wanted.shift()!);
  if (ball.wornOut) return;
  advanceSeeds(ball.seeds, dt, ball.z);
  // At speed, one step could carry the jelly clean through a mushroom or a rock. The step is cut into pieces short enough that
  // nothing can be skipped; events accumulate across the pieces.
  const pieces = clamp(Math.ceil((ballSpeed(ball) * dt) / MAX_TRAVEL_PER_PIECE), 1, MAX_PIECES_PER_STEP);
  const pieceDt = dt / pieces;
  for (let i = 0; i < pieces && !ball.wornOut; i++) advance(ball, input, pieceDt);
  stepStalactites(ball, dt);
  stepFlock(ball.flock, ball, dt, deliverToJelly);
}

function advance(ball: Ball, input: ControlInput, dt: number): void {
  const s = -ball.z;

  // Heading: where the ball is going over the ground, or the course itself
  // when it is barely moving. Control forces are expressed in this frame.
  const drift = courseDrift(s);
  const courseLength = Math.hypot(drift, 1);
  const courseX = drift / courseLength;
  const courseZ = -1 / courseLength;
  const horizontalSpeed = Math.hypot(ball.vx, ball.vz);
  const speedFactor = speedScale(s);
  const minSpeed = MIN_SPEED * speedFactor;
  let forwardX = courseX;
  let forwardZ = courseZ;
  if (horizontalSpeed > HEADING_MIN_SPEED) {
    forwardX = ball.vx / horizontalSpeed;
    forwardZ = ball.vz / horizontalSpeed;
  }
  const rightX = -forwardZ;
  const rightZ = forwardX;
  const authority = ball.grounded ? 1 : AIR_CONTROL;

  let ax = 0;
  let az = 0;
  // Sideways push grows with speed above the reference, so the jelly turns at
  // the same rate however fast it is going instead of becoming unsteerable.
  // The biome sets the grip: ice is slippery.
  const steer = clamp(input.steer, -1, 1) * STEER_ACCEL * steerScale(s) * Math.max(1, horizontalSpeed / STEER_REFERENCE_SPEED) * authority * (1 - SNOW_STEER_LOSS * ball.snow);
  ax += rightX * steer;
  az += rightZ * steer;

  const throttle = clamp(input.throttle, -1, 1);
  if (throttle > 0) {
    ax += forwardX * throttle * BOOST_ACCEL * authority;
    az += forwardZ * throttle * BOOST_ACCEL * authority;
  } else if (throttle < 0) {
    // Braking fades to nothing at the minimum speed: the jelly can slow but never stop.
    const fade = clamp((horizontalSpeed - minSpeed) / BRAKE_FADE_RANGE, 0, 1);
    ax += forwardX * throttle * BRAKE_ACCEL * fade * authority;
    az += forwardZ * throttle * BRAKE_ACCEL * fade * authority;
  }

  // Whatever slowed it (a rock, a bank, a rise), the course pulls it on again.
  // This applies in the air too: a head-on rock hit pops the jelly upward, and
  // waiting for it to land before recovering would leave it hanging.
  const alongCourse = ball.vx * courseX + ball.vz * courseZ;
  if (alongCourse < minSpeed) {
    ax += courseX * NUDGE_ACCEL;
    az += courseZ * NUDGE_ACCEL;
  }

  const tuckTarget = Math.max(0, throttle);
  const tuckRate = tuckTarget > ball.tuck ? TUCK_RISE_RATE : TUCK_FALL_RATE;
  ball.tuck += clamp(tuckTarget - ball.tuck, -tuckRate * dt, tuckRate * dt);
  const drag = DRAG + (TUCKED_DRAG - DRAG) * ball.tuck;
  const dragScale = (drag / (speedFactor * speedFactor)) * ballSpeed(ball);
  ball.vx += (ax - ball.vx * dragScale) * dt;
  const weight = ball.glassSeconds > 0 && !ball.grounded ? GLASS_WEIGHT : 1;
  ball.vy += (-GRAVITY * weight - ball.vy * dragScale) * dt;
  ball.vz += (az - ball.vz * dragScale) * dt;
  // Drag levels W off at the top speed on an average slope; on steep ground
  // gravity would carry the jelly past it, so the limit is also enforced
  // outright. Direction is kept and the excess simply shed.
  const fastest = ballSpeed(ball);
  if (fastest > MAX_SPEED) {
    const limit = MAX_SPEED / fastest;
    ball.vx *= limit; ball.vy *= limit; ball.vz *= limit;
  }

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;

  containInValley(ball);
  collideWithGround(ball);
  collideWithRocks(ball, dt);
  collideWithStalagmites(ball, dt);
  smashStalactites(ball);
  jump(ball, input.jump === true, dt);
  collectMagnet(ball, dt);
  collectSeedPacket(ball);
  collectGlass(ball, dt);
  collectBee(ball);
  absorbMushrooms(ball);
  if (ball.grounded) wear(ball, Math.hypot(ball.vx, ball.vy, ball.vz) * dt);
  else ball.airSeconds += dt;
  applyHole(ball, dt, minSpeed);
  packSnow(ball, dt, minSpeed);
  roll(ball, dt);
  ball.clock += dt;

  if (-ball.z > ball.distance) ball.distance = -ball.z;
}

/**
 * The banks are steep enough to turn almost anything back, but a fast jelly
 * steered straight at one could still crest the ridge and leave the drawn
 * world. Just short of the crest it is turned back, like a soft kerb.
 */
function containInValley(ball: Ball): void {
  const s = -ball.z;
  const centre = courseCenter(s);
  const limit = courseHalfWidth(s) + RIDGE_DISTANCE - RIDGE_BARRIER_INSET;
  const offset = ball.x - centre;
  if (Math.abs(offset) <= limit) return;
  const side = Math.sign(offset);
  ball.x = centre + side * limit;
  if (ball.vx * side > 0) ball.vx *= -RIDGE_BARRIER_RESTITUTION;
}

/**
 * The jelly is a sphere, not a point: it also rests on whatever ground is under its sides. The ground is looked at on a
 * ring under the sphere, and the sphere is held up clear of each of those points (a point `d` from the centre line holds
 * the centre sqrt(r^2 - d^2) above it). On smooth ground this never asks for more than the test under the centre does; it
 * matters at a sharp edge, so the jelly cannot sink into a pit narrower than itself or have a pit's wall pass through it.
 */
function restOnRim(ball: Ball): void {
  if (-ball.z < HAZARD_FREE_UNTIL) return;
  const reach = ball.radius * RIM_RING, lift = ball.radius * RIM_LIFT;
  let needed = Number.NEGATIVE_INFINITY;
  for (let k = 0; k < RIM_POINTS; k++) {
    needed = Math.max(needed, terrainHeight(ball.x + RIM_COS[k] * reach, ball.z + RIM_SIN[k] * reach) + lift);
  }
  if (ball.y >= needed) return;
  ball.y = needed;
  if (ball.vy < 0) { if (-ball.vy > ball.impact) ball.impact = -ball.vy; ball.vy = 0; }
  ball.grounded = true;
}

/** The ring: this many points, this share of the radius out from the centre line; a point there holds the centre sqrt(1 - share^2) radii above it. */
const RIM_POINTS = 6;
const RIM_RING = 0.7;
const RIM_LIFT = Math.sqrt(1 - RIM_RING * RIM_RING);
const RIM_COS = Array.from({ length: RIM_POINTS }, (_, k) => Math.cos((k / RIM_POINTS) * Math.PI * 2));
const RIM_SIN = Array.from({ length: RIM_POINTS }, (_, k) => Math.sin((k / RIM_POINTS) * Math.PI * 2));

function collideWithGround(ball: Ball): void {
  const height = terrainNormal(ball.x, ball.z, normal);
  ball.nx = normal.x; ball.ny = normal.y; ball.nz = normal.z;
  const clearance = (ball.y - height) * normal.y - ball.radius;
  if (clearance >= 0) {
    ball.grounded = clearance < GROUND_CONTACT_SLOP;
    restOnRim(ball);
    return;
  }
  ball.x -= normal.x * clearance;
  ball.y -= normal.y * clearance;
  ball.z -= normal.z * clearance;
  ball.grounded = true;
  const into = ball.vx * normal.x + ball.vy * normal.y + ball.vz * normal.z;
  if (into >= 0) return;
  const impact = -into;
  // A heavier marble bounces less: it absorbs the harder landings outright, and gives back a smaller share of the rest.
  const heavy = ball.glassSeconds > 0 ? GLASS_WEIGHT : 1;
  const restitution = impact > BOUNCE_MIN_IMPACT * heavy ? GROUND_RESTITUTION / heavy : 0;
  const remove = into * (1 + restitution);
  ball.vx -= normal.x * remove;
  ball.vy -= normal.y * remove;
  ball.vz -= normal.z * remove;
  if (impact > ball.impact) ball.impact = impact;
  restOnRim(ball);
}

function collideWithRocks(ball: Ball, dt: number): void {
  const cellX = rockCellIndex(ball.x);
  const cellZ = rockCellIndex(ball.z);
  for (let dz = -NEIGHBOUR_CELLS; dz <= NEIGHBOUR_CELLS; dz++) {
    for (let dx = -NEIGHBOUR_CELLS; dx <= NEIGHBOUR_CELLS; dx++) {
      if (!rockInCell(cellX + dx, cellZ + dz, rock) || isRockBroken(ball.brokenRocks, cellX + dx, cellZ + dz)) continue;
      const ox = ball.x - rock.x;
      const oy = ball.y - rock.y;
      const oz = ball.z - rock.z;
      const reach = ball.radius + rock.radius;
      const distanceSquared = ox * ox + oy * oy + oz * oz;
      if (distanceSquared >= reach * reach || distanceSquared === 0) continue;
      const distance = Math.sqrt(distanceSquared);
      if (ball.glassSeconds > 0 && ball.brokenCount < MAX_BROKEN_PER_STEP) {
        // A glass marble does not bounce off a rock: it smashes it and rolls on, a little slower.
        breakRock(ball.brokenRocks, cellX + dx, cellZ + dz);
        const gone = ball.broken[ball.brokenCount++];
        gone.x = rock.x; gone.y = rock.y; gone.z = rock.z; gone.radius = rock.radius; gone.look = rock.look;
        const struck = Math.max(0, -(ball.vx * ox + ball.vy * oy + ball.vz * oz) / distance);
        if (struck > ball.rockImpact) ball.rockImpact = struck;
        ball.vx *= GLASS_BREAK_KEEP; ball.vy *= GLASS_BREAK_KEEP; ball.vz *= GLASS_BREAK_KEEP;
        continue;
      }
      const px = ox / distance;
      const py = oy / distance;
      const pz = oz / distance;
      const overlap = reach - distance;
      ball.x += px * overlap;
      ball.y += py * overlap;
      ball.z += pz * overlap;
      // A slow jelly leaning on the uphill face of a rock is being pushed
      // straight into it by the course's pull, and can balance there for
      // seconds. Slide it off round whichever side it is already nearer.
      if (Math.hypot(ball.vx, ball.vz) < MIN_SPEED * speedScale(-ball.z)) {
        const drift = courseDrift(-ball.z);
        const courseLength = Math.hypot(drift, 1);
        const rightX = 1 / courseLength, rightZ = drift / courseLength;
        const side = ox * rightX + oz * rightZ;
        // Dead centre: let the rock itself break the tie, the same way every time.
        const sign = Math.abs(side) > ROCK_SLIDE_TIE ? Math.sign(side) : (rock.look < HALF ? -1 : 1);
        ball.vx += rightX * sign * ROCK_SLIDE_ACCEL * dt;
        ball.vz += rightZ * sign * ROCK_SLIDE_ACCEL * dt;
      }
      const into = ball.vx * px + ball.vy * py + ball.vz * pz;
      if (into >= 0) continue;
      // Split velocity into the part driving into the rock and the part
      // sliding past it. Bounce the first; scrub the second in proportion to
      // how hard it hit, so a jelly merely resting against a rock slides
      // around it instead of being held there.
      const tangentX = ball.vx - px * into;
      const tangentY = ball.vy - py * into;
      const tangentZ = ball.vz - pz * into;
      const tangentSpeed = Math.hypot(tangentX, tangentY, tangentZ);
      const scrub = Math.min(tangentSpeed, -into * ROCK_FRICTION);
      const keep = tangentSpeed > 0 ? (tangentSpeed - scrub) / tangentSpeed : 0;
      const bounce = -into * ROCK_RESTITUTION;
      ball.vx = tangentX * keep + px * bounce;
      ball.vy = tangentY * keep + py * bounce;
      ball.vz = tangentZ * keep + pz * bounce;
      if (-into > ball.rockImpact) ball.rockImpact = -into;
    }
  }
}

/**
 * Space hops the jelly off the ground along the surface normal. A press just
 * before landing, or just after rolling off an edge, still counts; holding the
 * key does not repeat.
 */
function jump(ball: Ball, held: boolean, dt: number): void {
  ball.airTime = ball.grounded ? 0 : ball.airTime + dt;
  ball.jumpQueued = held && !ball.jumpHeld ? 0 : ball.jumpQueued + dt;
  ball.jumpHeld = held;
  if (ball.jumpQueued > JUMP_BUFFER_SECONDS || ball.airTime > JUMP_COYOTE_SECONDS) return;
  // Replace any into-ground speed rather than adding to it, so every hop is the same height.
  const along = ball.vx * ball.nx + ball.vy * ball.ny + ball.vz * ball.nz;
  const boost = JUMP_SPEED - Math.min(along, 0);
  ball.vx += ball.nx * boost; ball.vy += ball.ny * boost; ball.vz += ball.nz * boost;
  ball.grounded = false;
  ball.jumped = true;
  ball.jumpQueued = NEVER;
  ball.airTime = NEVER;
}

/**
 * Rolling fast over snow packs it on; going slower than SHED_SPEED lets it fall off, the slower the faster; rolling on
 * ground that is not snow (including the changeover to the next biome, in proportion to how little of it is snow)
 * scrapes it off; and it slowly melts in the air off the snow.
 */
function packSnow(ball: Ball, dt: number, minSpeed: number): void {
  const speed = Math.hypot(ball.vx, ball.vz);
  const share = snowAt(-ball.z);
  const shedBelow = SNOW_SHED_SPEED_FACTOR * minSpeed;
  if (ball.grounded && share > 0 && speed >= shedBelow) ball.snow = Math.min(1, ball.snow + (speed * dt * share) / SNOW_FULL_METRES);
  else if (speed < shedBelow) ball.snow = Math.max(0, ball.snow - SNOW_SHED_RATE * (1 - speed / shedBelow) * dt);
  const bare = 1 - share;
  if (bare > 0) ball.snow = Math.max(0, ball.snow - (ball.grounded ? SNOW_SCRAPE_RATE : SNOW_MELT_RATE) * bare * dt);
}

const hole: HazardSample = createHazardSample();

/**
 * What the ground does to a jelly in a hole. Ponds and lava slow it and melt it, shards tear
 * pieces off, vents burn it and throw it up in pulses. Nothing is instant: each only takes a
 * little at a time, and none of them can slow the jelly below its minimum speed.
 */
function applyHole(ball: Ball, dt: number, minSpeed: number): void {
  const s = -ball.z;
  const depth = holeEffectAt(ball.x, ball.z, hole);
  ball.hazardDepth = depth;
  ball.hazardLevel = depth > 0 && isLiquidKind(hole.kind) ? holeLevel(hole) : Number.NaN;
  if (depth === 0) { ball.venting = false; return; }
  ball.hazardKind = hole.kind;
  const effect = HAZARD_EFFECTS[hole.kind];
  const harder = 1 + HAZARD_HARDER_GAIN * hazardShape(s);
  const height = ball.y - terrainHeight(ball.x, ball.z) - ball.radius;
  if (ball.grounded) {
    if (effect.slow > 0) {
      const speed = Math.hypot(ball.vx, ball.vz);
      if (speed > minSpeed) {
        const keep = Math.max(minSpeed, speed * Math.exp(-effect.slow * harder * depth * dt)) / speed;
        ball.vx *= keep; ball.vz *= keep;
      }
    }
    if (effect.melt > 0) meltBy(ball, effect.melt * harder * depth * dt);
    if (effect.stab > 0) {
      ball.stabMetres += Math.hypot(ball.vx, ball.vz) * dt * depth;
      if (ball.stabMetres >= HAZARD_STAB_SPACING) {
        ball.stabMetres -= HAZARD_STAB_SPACING;
        ball.stabs++;
        ball.vx *= HAZARD_STAB_KEEP; ball.vz *= HAZARD_STAB_KEEP;
        meltBy(ball, effect.stab * harder);
      }
    }
  }
  if (effect.lift > 0 && height < HAZARD_VENT_HEIGHT) {
    const phase = ball.clock * HAZARD_VENT_RATE + s * HAZARD_VENT_PHASE_PER_METRE;
    const lifting = phase - Math.floor(phase) < HAZARD_VENT_DUTY;
    if (lifting) {
      ball.vy += effect.lift * depth * dt;
      if (!ball.venting) ball.vented = true;
    }
    ball.venting = lifting;
  } else {
    ball.venting = false;
  }
}

/** Take a fraction of the jelly's radius away. */
export function meltBy(ball: Ball, fraction: number): void {
  if (ball.glassSeconds > 0) return;
  ball.lost += ball.radius * fraction;
  ball.radius -= ball.radius * fraction;
  if (ball.radius <= MIN_RADIUS) { ball.radius = MIN_RADIUS; ball.wornOut = true; }
}

/** Rolling scuffs the jelly away; how fast depends on the biome under it. `metres` is ground distance covered. */
export function wear(ball: Ball, metres: number): void {
  if (ball.glassSeconds > 0) return;
  const worn = (WEAR_PER_METRE + WEAR_PER_METRE_PER_RADIUS * ball.radius) * wearScale(-ball.z) * shieldFactorAt(-ball.z, ball.shieldLevels) * metres * (1 - SNOW_WEAR_PROTECTION * ball.snow);
  ball.radius -= worn;
  if (ball.radius <= MIN_RADIUS) { ball.radius = MIN_RADIUS; ball.wornOut = true; }
}

/**
 * Merge a mushroom of `mushroomRadius` into the jelly. Volume is conserved, as when
 * two jellies become one, but the gain tapers off toward MAX_RADIUS.
 */
export function grow(ball: Ball, mushroomRadius: number): void {
  const room = 1 - (ball.radius / MAX_RADIUS) ** 3;
  const volume = ball.radius ** 3 + mushroomRadius ** 3 * Math.max(0, room);
  const radius = Math.min(MAX_RADIUS, Math.cbrt(volume));
  // The centre rises with the radius so the jelly grows up off the ground, not into it.
  ball.y += radius - ball.radius;
  ball.radius = radius;
}

/** True while a magnet is pulling mushrooms in. */
export function magnetActive(ball: Ball): boolean {
  return ball.magnetSeconds > 0;
}

/** Start (or restart) the magnet's ten seconds. */
export function grantMagnet(ball: Ball): void {
  ball.magnetSeconds = MAGNET_SECONDS;
  ball.magnetPicked = true;
}

/** Count the magnet down, and pick up a floating one if the jelly rolls or flies through it. */
function collectMagnet(ball: Ball, dt: number): void {
  ball.magnetSeconds = Math.max(0, ball.magnetSeconds - dt);
  const segment = magnetSegment(-ball.z);
  if (segment === ball.magnetTakenSegment || !magnetInSegment(segment, magnet)) return;
  const reach = ball.radius + MAGNET_PICKUP_RADIUS;
  const dx = magnet.x - ball.x, dy = magnet.y - ball.y, dz = magnet.z - ball.z;
  if (dx * dx + dy * dy + dz * dz >= reach * reach) return;
  ball.magnetTakenSegment = segment;
  stockUp(ball, POWERUP_MAGNET);
  ball.magnetPicked = true;
}

/**
 * Spray a packet's worth of seeds down the valley from the jelly. `key` makes
 * the pattern repeatable: a packet always sprays the same way.
 */
export function spraySeeds(ball: Ball, key: number): void {
  plantSeeds(ball.seeds, ball.x, ball.y + ball.radius, ball.z, key);
  ball.seedsSprayed = true;
}

/** Pick up a floating seed packet if the jelly rolls or flies through it. */
function collectSeedPacket(ball: Ball): void {
  const segment = seedPacketSegment(-ball.z);
  if (segment === ball.seedTakenSegment || !seedPacketInSegment(segment, seedPacket)) return;
  const reach = ball.radius + SEED_PACKET_PICKUP_RADIUS;
  const dx = seedPacket.x - ball.x, dy = seedPacket.y - ball.y, dz = seedPacket.z - ball.z;
  if (dx * dx + dy * dy + dz * dz >= reach * reach) return;
  ball.seedTakenSegment = segment;
  stockUp(ball, POWERUP_SEEDS);
  ball.packetFound = true;
}

/** Record a merge: fill the next pickup, grow the jelly, and count it. */
function takePickup(
  ball: Ball, ox: number, oy: number, oz: number, distanceSquared: number,
  radius: number, kind: number, look: number, color: number, color2: number, seed: number,
): void {
  const distance = Math.sqrt(distanceSquared) || 1;
  const pickup = ball.pickups[ball.pickupCount++];
  pickup.dx = ox / distance; pickup.dy = oy / distance; pickup.dz = oz / distance; pickup.distance = distance;
  pickup.radius = radius; pickup.kind = kind; pickup.look = look;
  pickup.color = color; pickup.color2 = color2; pickup.seed = seed;
  const before = ball.radius;
  grow(ball, radius);
  pickup.jellyRadius = before;
  pickup.volume = ball.radius ** 3 - before ** 3;
  ball.merges++;
  ball.shieldCounts[kind]++;
  const level = shieldLevel(ball.shieldCounts[kind]);
  if (level > ball.shieldLevels[kind]) { ball.shieldLevels[kind] = level; ball.shieldUp = kind; }
}

function absorbMushrooms(ball: Ball): void {
  // With a magnet the jelly reaches well beyond its own skin.
  const pull = magnetActive(ball) ? MAGNET_RADIUS : 0;
  const reachCells = Math.ceil((ball.radius + pull) / MUSHROOM_CELL_REACH_DIVISOR) + 1;
  const cellX = mushroomCellIndex(ball.x);
  const cellZ = mushroomCellIndex(ball.z);
  for (let dz = -reachCells; dz <= reachCells; dz++) {
    for (let dx = -reachCells; dx <= reachCells; dx++) {
      if (ball.pickupCount === MAX_PICKUPS_PER_STEP) return;
      if (!mushroomInCell(cellX + dx, cellZ + dz, mushroom)) continue;
      const ox = mushroom.x - ball.x;
      const oy = mushroom.y - ball.y;
      const oz = mushroom.z - ball.z;
      const reach = ball.radius + pull + mushroom.radius * MUSHROOM_TOUCH;
      const distanceSquared = ox * ox + oy * oy + oz * oz;
      if (distanceSquared >= reach * reach) continue;
      if (isMushroomTaken(ball.ledger, cellX + dx, cellZ + dz)) continue;
      takeMushroom(ball.ledger, cellX + dx, cellZ + dz);
      takePickup(ball, ox, oy, oz, distanceSquared, mushroom.radius, mushroom.kind, mushroom.look, mushroom.color, mushroom.color2, mushroom.seed);
    }
  }
  // Collectibles grown from seeds: only once landed, and as big as they have sprouted so far.
  for (const planted of ball.seeds.items) {
    if (!planted.alive || ball.pickupCount === MAX_PICKUPS_PER_STEP) continue;
    const grown = sproutScale(planted);
    if (grown <= 0) continue;
    const ox = planted.x - ball.x, oy = planted.y - ball.y, oz = planted.z - ball.z;
    const reach = ball.radius + pull + planted.radius * grown * MUSHROOM_TOUCH;
    const distanceSquared = ox * ox + oy * oy + oz * oz;
    if (distanceSquared >= reach * reach) continue;
    planted.alive = false;
    takePickup(ball, ox, oy, oz, distanceSquared, planted.radius, planted.kind, planted.look, planted.color, planted.color2, planted.seed);
  }
}

/** Rolling without slipping on the ground; spin coasts and relaxes in the air. */
function roll(ball: Ball, dt: number): void {
  if (ball.grounded) {
    const targetX = (ball.ny * ball.vz - ball.nz * ball.vy) / ball.radius;
    const targetY = (ball.nz * ball.vx - ball.nx * ball.vz) / ball.radius;
    const targetZ = (ball.nx * ball.vy - ball.ny * ball.vx) / ball.radius;
    const follow = Math.min(1, SPIN_FOLLOW_RATE * dt);
    ball.wx += (targetX - ball.wx) * follow;
    ball.wy += (targetY - ball.wy) * follow;
    ball.wz += (targetZ - ball.wz) * follow;
  }
  // q' = q + dt/2 * (w ⊗ q)
  const hx = ball.wx * dt * HALF;
  const hy = ball.wy * dt * HALF;
  const hz = ball.wz * dt * HALF;
  const { qx, qy, qz, qw } = ball;
  ball.qx = qx + hx * qw + hy * qz - hz * qy;
  ball.qy = qy - hx * qz + hy * qw + hz * qx;
  ball.qz = qz + hx * qy - hy * qx + hz * qw;
  ball.qw = qw - hx * qx - hy * qy - hz * qz;
  const inverseLength = 1 / Math.hypot(ball.qx, ball.qy, ball.qz, ball.qw);
  ball.qx *= inverseLength; ball.qy *= inverseLength; ball.qz *= inverseLength; ball.qw *= inverseLength;
}

/** Start (or restart) the glass marble's seconds. */
export function grantGlass(ball: Ball): void {
  ball.glassSeconds = GLASS_SECONDS;
  ball.glassPicked = true;
}

/** Count the glass down, and pick up a floating marble if the jelly rolls or flies through it. */
function collectGlass(ball: Ball, dt: number): void {
  ball.glassSeconds = Math.max(0, ball.glassSeconds - dt);
  const segment = pickupSegment(GLASS_PICKUP, -ball.z);
  if (segment === ball.glassTakenSegment || !pickupInSegment(GLASS_PICKUP, segment, glassSpot)) return;
  const reach = ball.radius + GLASS_PICKUP_RADIUS;
  const dx = glassSpot.x - ball.x, dy = glassSpot.y - ball.y, dz = glassSpot.z - ball.z;
  if (dx * dx + dy * dy + dz * dz >= reach * reach) return;
  ball.glassTakenSegment = segment;
  stockUp(ball, POWERUP_GLASS);
  ball.glassPicked = true;
}

/** Keep a found power-up in its slot. */
function stockUp(ball: Ball, slot: number): void {
  ball.stock[slot] = Math.min(STOCK_MAX, ball.stock[slot] + 1);
}

/** A number key was pressed: use that slot's power-up at the start of the next step. */
export function wantPowerup(ball: Ball, slot: number): void {
  if (ball.wanted.length < POWERUP_SLOTS * 2) ball.wanted.push(slot);
}

/** Use a kept power-up (the number keys): one is taken from its slot and it takes effect now. False when there is none. */
export function usePowerup(ball: Ball, slot: number): boolean {
  if (ball.wornOut || slot < 0 || slot >= POWERUP_SLOTS || ball.stock[slot] <= 0) return false;
  ball.stock[slot]--;
  if (slot === POWERUP_MAGNET) grantMagnet(ball);
  else if (slot === POWERUP_GLASS) grantGlass(ball);
  else spraySeeds(ball, seedPacketSegment(-ball.z));
  return true;
}

/** A bee, if one is floating here and the flock has room. It joins the flock where it was found. */
function collectBee(ball: Ball): void {
  const segment = pickupSegment(BEE_PICKUP, -ball.z);
  if (segment === ball.beeTakenSegment || ball.flock.count >= BEE_MAX || !pickupInSegment(BEE_PICKUP, segment, beeSpot)) return;
  const reach = ball.radius + BEE_PICKUP_RADIUS;
  const dx = beeSpot.x - ball.x, dy = beeSpot.y - ball.y, dz = beeSpot.z - ball.z;
  if (dx * dx + dy * dy + dz * dz >= reach * reach) return;
  ball.beeTakenSegment = segment;
  addBee(ball.flock, beeSpot.x, beeSpot.y, beeSpot.z);
  ball.beePicked = true;
}

/** A bee hands the jelly what it carried: it merges as if the jelly had rolled through it. False if this step has no room for another. */
function deliverToJelly(ball: Ball, ox: number, oy: number, oz: number, distanceSquared: number, item: Item): boolean {
  if (ball.pickupCount === MAX_PICKUPS_PER_STEP) return false;
  takePickup(ball, ox, oy, oz, distanceSquared, item.radius, item.kind, item.look, item.color, item.color2, item.seed);
  return true;
}

const spike = createSpike();
const SPIKE_CELL_SIZE = SPIKE_CELL;
/** Cells searched round the jelly for a stalagmite to hit: its own and its neighbours'. */
const SPIKE_NEIGHBOURS = 1;
const NEAR_SPIKES = (2 * SPIKE_NEIGHBOURS + 1) ** 2;
const nearSpikes = Array.from({ length: NEAR_SPIKES }, createSpike);
const nearHas: boolean[] = Array.from({ length: NEAR_SPIKES }, () => false);
let nearCellX = Number.NaN, nearCellZ = Number.NaN;
// Where the holes are decides where stalagmites may stand, so a change of holes means looking again.
onHazardsChanged(() => { nearCellX = Number.NaN; });

/**
 * Stalagmites are posts: the jelly bounces off them sideways (and, when it is barely moving, is slid round them like a
 * rock). A glass marble knocks them over without being affected at all, and rolls on.
 */
function collideWithStalagmites(ball: Ball, dt: number): void {
  if (caveAt(-ball.z) === 0) return;
  const cellX = spikeCellIndex(ball.x), cellZ = spikeCellIndex(ball.z);
  // The stalagmites round the jelly are looked up once per cell it enters, not on every piece of every step.
  if (cellX !== nearCellX || cellZ !== nearCellZ) {
    nearCellX = cellX; nearCellZ = cellZ;
    let n = 0;
    for (let dz = -SPIKE_NEIGHBOURS; dz <= SPIKE_NEIGHBOURS; dz++) {
      for (let dx = -SPIKE_NEIGHBOURS; dx <= SPIKE_NEIGHBOURS; dx++, n++) nearHas[n] = stalagmiteInCell(cellX + dx, cellZ + dz, nearSpikes[n]);
    }
  }
  let n = -1;
  for (let dz = -SPIKE_NEIGHBOURS; dz <= SPIKE_NEIGHBOURS; dz++) {
    for (let dx = -SPIKE_NEIGHBOURS; dx <= SPIKE_NEIGHBOURS; dx++) {
      n++;
      if (!nearHas[n]) continue;
      const spike = nearSpikes[n];
      if (isRockBroken(ball.toppledSpikes, cellX + dx, cellZ + dz)) continue;
      // Above the post (it tapers to nothing), the jelly passes over.
      if (ball.y - ball.radius > spike.y + spike.length * STALAGMITE_POST_HEIGHT) continue;
      const ox = ball.x - spike.x, oz = ball.z - spike.z;
      const reach = ball.radius + spike.radius * STALAGMITE_POST_RADIUS;
      const distanceSquared = ox * ox + oz * oz;
      if (distanceSquared >= reach * reach || distanceSquared === 0) continue;
      const distance = Math.sqrt(distanceSquared);
      const px = ox / distance, pz = oz / distance;
      const into = ball.vx * px + ball.vz * pz;
      if (ball.glassSeconds > 0 && ball.toppledCount < MAX_SPIKE_EVENTS) {
        breakRock(ball.toppledSpikes, cellX + dx, cellZ + dz);
        const event = ball.toppled[ball.toppledCount++];
        const speed = Math.hypot(ball.vx, ball.vz) || 1;
        event.x = spike.x; event.y = spike.y; event.z = spike.z; event.radius = spike.radius; event.length = spike.length; event.look = spike.look;
        event.dirX = ball.vx / speed; event.dirZ = ball.vz / speed;
        // The marble is not slowed or knocked about by them: they just go over.
        if (-into > ball.rockImpact) ball.rockImpact = -into;
        continue;
      }
      ball.x += px * (reach - distance); ball.z += pz * (reach - distance);
      if (Math.hypot(ball.vx, ball.vz) < MIN_SPEED * speedScale(-ball.z)) {
        // Leaning on the uphill side of a post: slide off round whichever side it is nearer, as with a rock.
        const drift = courseDrift(-ball.z);
        const courseLength = Math.hypot(drift, 1);
        const rightX = 1 / courseLength, rightZ = drift / courseLength;
        const side = ox * rightX + oz * rightZ;
        const sign = Math.abs(side) > ROCK_SLIDE_TIE ? Math.sign(side) : (spike.look < HALF ? -1 : 1);
        ball.vx += rightX * sign * ROCK_SLIDE_ACCEL * dt;
        ball.vz += rightZ * sign * ROCK_SLIDE_ACCEL * dt;
      }
      if (into >= 0) continue;
      const remove = into * (1 + STALAGMITE_RESTITUTION);
      ball.vx -= px * remove; ball.vz -= pz * remove;
      if (-into > ball.rockImpact) ball.rockImpact = -into;
    }
  }
}

/**
 * A glass marble smashes any stalactite it touches, hanging or falling, and is not hurt: the stalactite goes to pieces where it
 * was touched and is gone from the roof.
 */
function smashStalactites(ball: Ball): void {
  if (ball.glassSeconds <= 0 || caveAt(-ball.z) === 0) return;
  const cellX = spikeCellIndex(ball.x), cellZ = spikeCellIndex(ball.z);
  for (let dz = -SPIKE_NEIGHBOURS; dz <= SPIKE_NEIGHBOURS; dz++) {
    for (let dx = -SPIKE_NEIGHBOURS; dx <= SPIKE_NEIGHBOURS; dx++) {
      if (!stalactiteInCell(cellX + dx, cellZ + dz, spike) || isRockBroken(ball.fallenSpikes, cellX + dx, cellZ + dz)) continue;
      const tip = spike.y + spike.tip;
      if (ball.y + ball.radius <= tip || ball.y - ball.radius >= tip + spike.length) continue;
      const ox = spike.x - ball.x, oz = spike.z - ball.z, reach = ball.radius + spike.radius * HALF + STALACTITE_HIT_MARGIN;
      if (ox * ox + oz * oz >= reach * reach || ball.landedCount >= MAX_SPIKE_EVENTS) continue;
      breakRock(ball.fallenSpikes, cellX + dx, cellZ + dz);
      const event = ball.landed[ball.landedCount++];
      event.x = spike.x; event.y = tip; event.z = spike.z; event.radius = spike.radius; event.length = spike.length; event.look = spike.look;
      event.dirX = 0; event.dirZ = -1;
      ball.spikeHit = true;
    }
  }
}

/** A falling stalactite ends: it is reported (for the pieces and the sound), and if it struck the jelly, it hurts. */
function endFaller(ball: Ball, faller: Faller, hit: boolean): void {
  faller.active = false;
  if (ball.landedCount < MAX_SPIKE_EVENTS) {
    const event = ball.landed[ball.landedCount++];
    event.x = faller.x; event.y = Math.max(faller.ground, faller.tip); event.z = faller.z; event.radius = faller.radius; event.length = faller.length; event.look = faller.look;
    event.dirX = 0; event.dirZ = -1;
  }
  if (!hit) return;
  ball.spikeHit = true;
  if (ball.glassSeconds > 0) return;
  meltBy(ball, STALACTITE_DAMAGE);
  ball.vx *= STALACTITE_HIT_KEEP; ball.vz *= STALACTITE_HIT_KEEP;
}

/**
 * Stalactites that fall. Every so often the cave ahead is looked over: one lets go when the jelly, at its present speed,
 * would arrive under it in about the time it takes to fall, so it comes down where the jelly is going, not behind it.
 * Those falling drop under gravity, and hurt if they strike.
 */
function stepStalactites(ball: Ball, dt: number): void {
  for (const faller of ball.fallers) {
    if (!faller.active) continue;
    faller.vy -= GRAVITY * dt;
    faller.tip += faller.vy * dt;
    const dx = faller.x - ball.x, dz = faller.z - ball.z;
    const reach = ball.radius + faller.radius * HALF + STALACTITE_HIT_MARGIN;
    const struck = dx * dx + dz * dz < reach * reach && faller.tip <= ball.y + ball.radius && faller.tip + faller.length >= ball.y - ball.radius;
    if (struck) endFaller(ball, faller, true);
    else if (faller.tip <= faller.ground) endFaller(ball, faller, false);
  }
  if (caveAt(-ball.z) === 0) return;
  ball.spikeScan += dt;
  if (ball.spikeScan < STALACTITE_SCAN_SECONDS) return;
  ball.spikeScan = 0;
  const speed = Math.hypot(ball.vx, ball.vz);
  if (speed < 1) return;
  const forwardX = ball.vx / speed, forwardZ = ball.vz / speed;
  const cells = Math.ceil(STALACTITE_TRIGGER_MAX / SPIKE_CELL_SIZE);
  const cellX = spikeCellIndex(ball.x), cellZ = spikeCellIndex(ball.z);
  for (let dz = -cells; dz <= cells; dz++) {
    for (let dx = -FALL_LANE_CELLS; dx <= FALL_LANE_CELLS; dx++) {
      if (!stalactiteInCell(cellX + dx, cellZ + dz, spike) || !spike.falls || isRockBroken(ball.fallenSpikes, cellX + dx, cellZ + dz)) continue;
      const ox = spike.x - ball.x, oz = spike.z - ball.z;
      const ahead = ox * forwardX + oz * forwardZ, aside = Math.abs(ox * forwardZ - oz * forwardX);
      if (ahead <= 0 || aside > FALL_LANE_METRES) continue;
      // Time for its tip to reach the height of the jelly's top, from rest.
      const drop = Math.max(0.5, spike.y + spike.tip - (ball.y + ball.radius));
      const trigger = Math.min(STALACTITE_TRIGGER_MAX, Math.max(STALACTITE_TRIGGER_MIN, speed * Math.sqrt((2 * drop) / GRAVITY) * STALACTITE_LEAD));
      if (ahead > trigger) continue;
      const faller = ball.fallers.find(f => !f.active);
      if (!faller) return;
      breakRock(ball.fallenSpikes, cellX + dx, cellZ + dz);
      faller.active = true; faller.x = spike.x; faller.z = spike.z; faller.ground = spike.y; faller.tip = spike.y + spike.tip; faller.vy = 0;
      faller.radius = spike.radius; faller.length = spike.length; faller.look = spike.look;
      ball.cracked++;
    }
  }
}

/** Only stalactites within this far of the jelly's line of travel fall on it (metres, and the cells that covers). */
const FALL_LANE_METRES = 5;
const FALL_LANE_CELLS = 2;
