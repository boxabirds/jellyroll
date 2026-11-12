/**
 * The bees: small fast pets. A bee flies out, takes a collectible nearby,
 * and brings it back to the jelly, which absorbs it as if it had rolled
 * through it. A bee carries more as it gains levels (see progression.ts).
 * With nothing to fetch, or its hands full and handed over, it flies beside
 * the jelly, the way a dog heels.
 *
 * Pure and allocation-free after creation, like the rest of the simulation.
 * The list of things worth fetching is rebuilt a few times a second and shared
 * by every bee.
 */
import type { Ball } from './physics.ts';
import { createMushroom, isMushroomTaken, mushroomCellIndex, mushroomInCell, takeMushroom, type Mushroom } from './mushrooms.ts';
import { beeCapacity, beeLevel } from './progression.ts';
import { terrainHeight } from './terrain.ts';
import {
  BEE_BOB_RATE, BEE_CARRY_CLEARANCE, BEE_DELIVER_REACH, BEE_GIVE_UP_BEHIND, BEE_GRAB_DISTANCE, BEE_GROUND_CLEARANCE, BEE_HEEL_BACK, BEE_HEEL_BACK_STEP,
  BEE_HEEL_RANK_STEP, BEE_HEEL_SIDE, BEE_HEEL_STIFFNESS, BEE_HOVER_BOB, BEE_MAX, BEE_MAX_CANDIDATES, BEE_MAX_CARGO, BEE_MIN_SPEED,
  BEE_SCAN_SECONDS, BEE_SEARCH_AHEAD, BEE_SEARCH_RADIUS, BEE_SETTLE_DISTANCE, BEE_SPEED_EXTRA, BEE_SPEED_FACTOR, BEE_STEER_RATE,
  MUSHROOM_CELL,
} from './tuning.ts';

/** What a bee is doing. */
export const HEELING = 0, FETCHING = 1, RETURNING = 2;
type Mode = typeof HEELING | typeof FETCHING | typeof RETURNING;

/** A collectible, as a bee holds it: where its cell is, and everything the merge will need. */
export type Item = {
  cellX: number; cellZ: number;
  x: number; y: number; z: number;
  radius: number; kind: number; look: number; color: number; color2: number; seed: number;
};

export type Bee = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  mode: Mode;
  /** The collectible it is going for (valid while FETCHING). */
  target: Item;
  /** What it is carrying: the first `carried` entries. */
  cargo: Item[];
  carried: number;
  /** Seconds since it appeared, for its bob. */
  age: number;
};

export type Flock = {
  bees: Bee[];
  /** How many of `bees` exist. */
  count: number;
  /** Collectibles brought to the jelly by bees: their experience. */
  delivered: number;
  /** True on the step a bee's level went up, and on the step a bee delivered. */
  levelledUp: boolean;
  deliveredNow: boolean;
  candidates: Item[];
  candidateCount: number;
  sinceScan: number;
};

const createItem = (): Item => ({ cellX: 0, cellZ: 0, x: 0, y: 0, z: 0, radius: 0, kind: 0, look: 0, color: 0, color2: 0, seed: 0 });
const copyItem = (from: Item, to: Item) => {
  to.cellX = from.cellX; to.cellZ = from.cellZ; to.x = from.x; to.y = from.y; to.z = from.z; to.radius = from.radius;
  to.kind = from.kind; to.look = from.look; to.color = from.color; to.color2 = from.color2; to.seed = from.seed;
};

function createBee(): Bee {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, mode: HEELING, target: createItem(),
    cargo: Array.from({ length: BEE_MAX_CARGO }, createItem), carried: 0, age: 0,
  };
}

export function createFlock(): Flock {
  return {
    bees: Array.from({ length: BEE_MAX }, createBee), count: 0, delivered: 0, levelledUp: false, deliveredNow: false,
    candidates: Array.from({ length: BEE_MAX_CANDIDATES }, createItem), candidateCount: 0, sinceScan: BEE_SCAN_SECONDS,
  };
}

export function resetFlock(flock: Flock): void {
  flock.count = 0; flock.delivered = 0; flock.levelledUp = false; flock.deliveredNow = false;
  flock.candidateCount = 0; flock.sinceScan = BEE_SCAN_SECONDS;
}

/** A new bee joins the flock where `x, y, z` is. Returns false if the flock is full. */
export function addBee(flock: Flock, x: number, y: number, z: number): boolean {
  if (flock.count >= BEE_MAX) return false;
  const bee = flock.bees[flock.count++];
  bee.x = x; bee.y = y; bee.z = z; bee.vx = 0; bee.vy = 0; bee.vz = 0;
  bee.mode = HEELING; bee.carried = 0; bee.age = 0;
  return true;
}

const scratch: Mushroom = createMushroom();

/** Rebuild the shared list of things worth fetching: collectibles still on the ground near the point just ahead of the jelly. */
function scan(flock: Flock, ball: Ball, forwardX: number, forwardZ: number): void {
  flock.candidateCount = 0;
  const centreX = ball.x + forwardX * BEE_SEARCH_AHEAD, centreZ = ball.z + forwardZ * BEE_SEARCH_AHEAD;
  const reach = Math.ceil(BEE_SEARCH_RADIUS / MUSHROOM_CELL);
  const cellX = mushroomCellIndex(centreX), cellZ = mushroomCellIndex(centreZ);
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (flock.candidateCount === BEE_MAX_CANDIDATES) return;
      if (!mushroomInCell(cellX + dx, cellZ + dz, scratch)) continue;
      if (isMushroomTaken(ball.ledger, cellX + dx, cellZ + dz)) continue;
      const item = flock.candidates[flock.candidateCount++];
      item.cellX = cellX + dx; item.cellZ = cellZ + dz;
      item.x = scratch.x; item.y = scratch.y; item.z = scratch.z; item.radius = scratch.radius;
      item.kind = scratch.kind; item.look = scratch.look; item.color = scratch.color; item.color2 = scratch.color2; item.seed = scratch.seed;
    }
  }
}

/** True if another bee is already going for the collectible in this cell (or carries it). */
function claimed(flock: Flock, self: Bee, cellX: number, cellZ: number): boolean {
  for (let i = 0; i < flock.count; i++) {
    const other = flock.bees[i];
    if (other !== self && other.mode === FETCHING && other.target.cellX === cellX && other.target.cellZ === cellZ) return true;
  }
  return false;
}

/** The nearest unclaimed collectible to the bee; copies it into the bee's target. */
function chooseTarget(flock: Flock, bee: Bee, ball: Ball): boolean {
  let best = -1, bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < flock.candidateCount; i++) {
    const item = flock.candidates[i];
    // Not ones the jelly has already left behind.
    if (item.z > ball.z + BEE_GIVE_UP_BEHIND) continue;
    if (isMushroomTaken(ball.ledger, item.cellX, item.cellZ) || claimed(flock, bee, item.cellX, item.cellZ)) continue;
    const distance = (item.x - bee.x) ** 2 + (item.y - bee.y) ** 2 + (item.z - bee.z) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = i; }
  }
  if (best < 0) return false;
  copyItem(flock.candidates[best], bee.target);
  return true;
}

/** How fast a bee flies when it is going somewhere: always faster than the jelly. */
export function beeSpeed(jellySpeed: number): number {
  return Math.max(BEE_MIN_SPEED, jellySpeed * BEE_SPEED_FACTOR + BEE_SPEED_EXTRA);
}

/** Steer a bee's velocity toward `want` (a velocity), then move it. */
function fly(bee: Bee, wantX: number, wantY: number, wantZ: number, dt: number): void {
  const follow = Math.min(1, BEE_STEER_RATE * dt);
  bee.vx += (wantX - bee.vx) * follow; bee.vy += (wantY - bee.vy) * follow; bee.vz += (wantZ - bee.vz) * follow;
  bee.x += bee.vx * dt; bee.y += bee.vy * dt; bee.z += bee.vz * dt;
  const floor = terrainHeight(bee.x, bee.z) + BEE_GROUND_CLEARANCE + (bee.mode === RETURNING ? BEE_CARRY_CLEARANCE : 0);
  if (bee.y < floor) { bee.y = floor; if (bee.vy < 0) bee.vy = 0; }
}

/** Fly straight at a point at the bee's top speed, easing off as it arrives. */
function flyTo(bee: Bee, x: number, y: number, z: number, speed: number, dt: number): number {
  const dx = x - bee.x, dy = y - bee.y, dz = z - bee.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const pace = speed * Math.min(1, distance / BEE_SETTLE_DISTANCE + 0.2);
  fly(bee, (dx / distance) * pace, (dy / distance) * pace, (dz / distance) * pace, dt);
  return distance;
}

/** Fly to this bee's place beside the jelly, carried along with it. */
function heel(bee: Bee, index: number, ball: Ball, forwardX: number, forwardZ: number, dt: number): void {
  const rank = Math.floor(index / 2), side = index % 2 === 0 ? 1 : -1;
  const rightX = -forwardZ, rightZ = forwardX;
  const lateral = side * (ball.radius + BEE_HEEL_SIDE + rank * BEE_HEEL_RANK_STEP);
  const back = BEE_HEEL_BACK + rank * BEE_HEEL_BACK_STEP;
  const bob = Math.sin(bee.age * BEE_BOB_RATE + index * 2) * BEE_HOVER_BOB;
  const x = ball.x + rightX * lateral - forwardX * back, z = ball.z + rightZ * lateral - forwardZ * back;
  const y = ball.y + bob;
  fly(bee, ball.vx + (x - bee.x) * BEE_HEEL_STIFFNESS, ball.vy + (y - bee.y) * BEE_HEEL_STIFFNESS, ball.vz + (z - bee.z) * BEE_HEEL_STIFFNESS, dt);
}

/** What a merge needs, handed to the code that knows how to do one. */
export type Deliver = (ball: Ball, ox: number, oy: number, oz: number, distanceSquared: number, item: Item) => boolean;

/** Advance every bee by `dt`. `deliver` merges one item into the jelly (and says whether it could: a step takes only so many). */
export function stepFlock(flock: Flock, ball: Ball, dt: number, deliver: Deliver): void {
  flock.levelledUp = false; flock.deliveredNow = false;
  if (flock.count === 0) return;
  const speed = Math.hypot(ball.vx, ball.vz);
  let forwardX = 0, forwardZ = -1;
  if (speed > 1) { forwardX = ball.vx / speed; forwardZ = ball.vz / speed; }
  flock.sinceScan += dt;
  const capacity = beeCapacity(flock.delivered);
  const needsScan = flock.sinceScan >= BEE_SCAN_SECONDS;
  if (needsScan) { flock.sinceScan = 0; scan(flock, ball, forwardX, forwardZ); }
  const pace = beeSpeed(Math.hypot(ball.vx, ball.vy, ball.vz));
  for (let i = 0; i < flock.count; i++) {
    const bee = flock.bees[i];
    bee.age += dt;
    if (bee.mode === HEELING) {
      if (bee.carried < capacity && chooseTarget(flock, bee, ball)) bee.mode = FETCHING;
      else if (bee.carried > 0) bee.mode = RETURNING;
    }
    if (bee.mode === FETCHING) {
      const gone = isMushroomTaken(ball.ledger, bee.target.cellX, bee.target.cellZ) || bee.target.z > ball.z + BEE_GIVE_UP_BEHIND;
      if (gone) bee.mode = bee.carried > 0 ? RETURNING : HEELING;
      else if (flyTo(bee, bee.target.x, bee.target.y, bee.target.z, pace, dt) < BEE_GRAB_DISTANCE) {
        takeMushroom(ball.ledger, bee.target.cellX, bee.target.cellZ);
        copyItem(bee.target, bee.cargo[bee.carried++]);
        if (bee.carried >= capacity) bee.mode = RETURNING;
        else if (!chooseTarget(flock, bee, ball)) bee.mode = RETURNING;
      }
    } else if (bee.mode === RETURNING) {
      const lead = 0.1;
      const distance = flyTo(bee, ball.x + ball.vx * lead, ball.y + ball.vy * lead, ball.z + ball.vz * lead, pace, dt);
      if (distance < ball.radius + BEE_DELIVER_REACH + BEE_SETTLE_DISTANCE * 0.5 && bee.carried > 0) {
        const item = bee.cargo[bee.carried - 1];
        const ox = bee.x - ball.x, oy = bee.y - ball.y, oz = bee.z - ball.z;
        if (deliver(ball, ox, oy, oz, ox * ox + oy * oy + oz * oz, item)) {
          bee.carried--;
          const before = beeLevel(flock.delivered);
          flock.delivered++;
          flock.deliveredNow = true;
          if (beeLevel(flock.delivered) > before) flock.levelledUp = true;
        }
      }
      if (bee.carried === 0) bee.mode = HEELING;
    } else {
      heel(bee, i, ball, forwardX, forwardZ, dt);
    }
  }
}
