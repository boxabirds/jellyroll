/**
 * Rigid rolling-ball simulation over the terrain function. Pure and
 * allocation-free per step: all scratch state lives in module scope or on the
 * ball itself. The jelly wobble is layered on top in wobble.ts.
 */
import { mushroomCellIndex, mushroomInCell, createMushroom, createMushroomLedger, isMushroomTaken, resetMushroomLedger, takeMushroom, type MushroomLedger } from './mushrooms.ts';
import { speedScale, steerScale, wearScale } from './biomes.ts';
import { createHazardSample, type HazardSample } from './hazards.ts';
import { createMagnet, magnetInSegment, magnetSegment } from './magnets.ts';
import { createSeedPacket, seedPacketInSegment, seedPacketSegment } from './seed-packets.ts';
import { advanceSeeds, clearSeeds, createSeedField, plantSeeds, sproutScale, type SeedField } from './seeds.ts';
import { clamp } from './noise.ts';
import { createRock, rockCellIndex, rockInCell } from './rocks.ts';
import { courseCenter, courseDrift, courseHalfWidth, holeEffectAt, terrainHeight, terrainNormal } from './terrain.ts';
import {
  AIR_CONTROL,
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
  GROUND_RESTITUTION,
  HAZARD_EFFECTS,
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
  /** Seconds the run has lasted (drives the pulsing of steam vents). */
  clock: number;
  /** The hole under the jelly: how deep in it (0 outside) and of what kind (a biome index). */
  hazardDepth: number; hazardKind: number;
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
  /** Stretch of the course whose magnet was last picked up, so it is not there twice. */
  magnetTakenSegment: number;
  /** True on the step a seed packet was picked up, and the stretch whose packet was last taken. */
  seedsSprayed: boolean;
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
const NEVER = Number.POSITIVE_INFINITY;
const NO_SEGMENT = -1;

export function createBall(): Ball {
  const ball: Ball = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, radius: START_RADIUS, wornOut: false,
    nx: 0, ny: 1, nz: 0, grounded: false,
    wx: 0, wy: 0, wz: 0, qx: 0, qy: 0, qz: 0, qw: 1,
    impact: 0, rockImpact: 0, jumped: false, distance: 0, airSeconds: 0,
    airTime: NEVER, jumpQueued: NEVER, jumpHeld: false, tuck: 0,
    clock: 0, hazardDepth: 0, hazardKind: 0, stabs: 0, vented: false, stabMetres: 0, venting: false,
    pickups: Array.from({ length: MAX_PICKUPS_PER_STEP }, () => ({ dx: 0, dy: 1, dz: 0, distance: 0, jellyRadius: 0, volume: 0, radius: 0, kind: 0, look: 0, color: 0, color2: 0, seed: 0 })),
    pickupCount: 0, merges: 0, magnetSeconds: 0, magnetPicked: false, magnetTakenSegment: NO_SEGMENT,
    seedsSprayed: false, seedTakenSegment: NO_SEGMENT, seeds: createSeedField(),
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
  ball.clock = 0; ball.hazardDepth = 0; ball.hazardKind = 0; ball.stabs = 0; ball.vented = false; ball.stabMetres = 0; ball.venting = false;
  ball.pickupCount = 0; ball.merges = 0;
  ball.magnetSeconds = 0; ball.magnetPicked = false; ball.magnetTakenSegment = NO_SEGMENT;
  ball.seedsSprayed = false; ball.seedTakenSegment = NO_SEGMENT; clearSeeds(ball.seeds);
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
  if (ball.wornOut) return;
  advanceSeeds(ball.seeds, dt, ball.z);
  // At speed, one step could carry the jelly clean through a mushroom or a rock. The step is cut into pieces short enough that
  // nothing can be skipped; events accumulate across the pieces.
  const pieces = clamp(Math.ceil((ballSpeed(ball) * dt) / MAX_TRAVEL_PER_PIECE), 1, MAX_PIECES_PER_STEP);
  const pieceDt = dt / pieces;
  for (let i = 0; i < pieces && !ball.wornOut; i++) advance(ball, input, pieceDt);
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
  const steer = clamp(input.steer, -1, 1) * STEER_ACCEL * steerScale(s) * Math.max(1, horizontalSpeed / STEER_REFERENCE_SPEED) * authority;
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
  ball.vy += (-GRAVITY - ball.vy * dragScale) * dt;
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
  jump(ball, input.jump === true, dt);
  collectMagnet(ball, dt);
  collectSeedPacket(ball);
  absorbMushrooms(ball);
  if (ball.grounded) wear(ball, Math.hypot(ball.vx, ball.vy, ball.vz) * dt);
  else ball.airSeconds += dt;
  applyHole(ball, dt, minSpeed);
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

function collideWithGround(ball: Ball): void {
  const height = terrainNormal(ball.x, ball.z, normal);
  ball.nx = normal.x; ball.ny = normal.y; ball.nz = normal.z;
  const clearance = (ball.y - height) * normal.y - ball.radius;
  if (clearance >= 0) {
    ball.grounded = clearance < GROUND_CONTACT_SLOP;
    return;
  }
  ball.x -= normal.x * clearance;
  ball.y -= normal.y * clearance;
  ball.z -= normal.z * clearance;
  ball.grounded = true;
  const into = ball.vx * normal.x + ball.vy * normal.y + ball.vz * normal.z;
  if (into >= 0) return;
  const impact = -into;
  const restitution = impact > BOUNCE_MIN_IMPACT ? GROUND_RESTITUTION : 0;
  const remove = into * (1 + restitution);
  ball.vx -= normal.x * remove;
  ball.vy -= normal.y * remove;
  ball.vz -= normal.z * remove;
  if (impact > ball.impact) ball.impact = impact;
}

function collideWithRocks(ball: Ball, dt: number): void {
  const cellX = rockCellIndex(ball.x);
  const cellZ = rockCellIndex(ball.z);
  for (let dz = -NEIGHBOUR_CELLS; dz <= NEIGHBOUR_CELLS; dz++) {
    for (let dx = -NEIGHBOUR_CELLS; dx <= NEIGHBOUR_CELLS; dx++) {
      if (!rockInCell(cellX + dx, cellZ + dz, rock)) continue;
      const ox = ball.x - rock.x;
      const oy = ball.y - rock.y;
      const oz = ball.z - rock.z;
      const reach = ball.radius + rock.radius;
      const distanceSquared = ox * ox + oy * oy + oz * oz;
      if (distanceSquared >= reach * reach || distanceSquared === 0) continue;
      const distance = Math.sqrt(distanceSquared);
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
  if (depth === 0) { ball.venting = false; return; }
  ball.hazardKind = hole.kind;
  const effect = HAZARD_EFFECTS[hole.kind];
  const height = ball.y - terrainHeight(ball.x, ball.z) - ball.radius;
  if (ball.grounded) {
    if (effect.slow > 0) {
      const speed = Math.hypot(ball.vx, ball.vz);
      if (speed > minSpeed) {
        const keep = Math.max(minSpeed, speed * Math.exp(-effect.slow * depth * dt)) / speed;
        ball.vx *= keep; ball.vz *= keep;
      }
    }
    if (effect.melt > 0) meltBy(ball, effect.melt * depth * dt);
    if (effect.stab > 0) {
      ball.stabMetres += Math.hypot(ball.vx, ball.vz) * dt * depth;
      if (ball.stabMetres >= HAZARD_STAB_SPACING) {
        ball.stabMetres -= HAZARD_STAB_SPACING;
        ball.stabs++;
        ball.vx *= HAZARD_STAB_KEEP; ball.vz *= HAZARD_STAB_KEEP;
        meltBy(ball, effect.stab);
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
function meltBy(ball: Ball, fraction: number): void {
  ball.radius -= ball.radius * fraction;
  if (ball.radius <= MIN_RADIUS) { ball.radius = MIN_RADIUS; ball.wornOut = true; }
}

/** Rolling scuffs the jelly away; how fast depends on the biome under it. `metres` is ground distance covered. */
export function wear(ball: Ball, metres: number): void {
  ball.radius -= (WEAR_PER_METRE + WEAR_PER_METRE_PER_RADIUS * ball.radius) * wearScale(-ball.z) * metres;
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
  grantMagnet(ball);
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
  spraySeeds(ball, segment);
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
