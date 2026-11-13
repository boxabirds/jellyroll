/**
 * Seeds sprayed by a seed packet. Each seed flies in an arc down the valley,
 * lands, and sprouts at once into a collectible of the biome it landed in.
 * Everything about a spray is a function of the packet's hash and where the
 * jelly was, so it is reproducible. Pure and allocation-free after creation.
 */
import { collectibleKind } from './biomes.ts';
import { hash2 } from './noise.ts';
import { pickLook } from './mushrooms.ts';
import { createHazardSample, hazardAt } from './hazards.ts';
import { createRock, rockCellIndex, rockInCell } from './rocks.ts';
import { courseCenter, courseHalfWidth, terrainHeight } from './terrain.ts';
import {
  MAX_PLANTED, MUSHROOM_MAX_RADIUS, MUSHROOM_MIN_RADIUS, MUSHROOM_REST_HEIGHT, SEED_ARC_HEIGHT_PER_METRE, SEED_BEHIND_DISTANCE,
  SEED_FAR, SEED_FLIGHT_MIN_SECONDS, SEED_FLIGHT_SECONDS_PER_METRE, SEED_GROW_SECONDS, SEED_LATERAL_PULL, SEED_LIFETIME_SECONDS,
  SEED_MIN_SIZE_SHARE, SEED_NEAR, SEED_PILE_RADIUS, SEED_PILES, SEED_PLACEMENT_TRIES, SEED_STAGGER_SECONDS, SEED_VALLEY_FRACTION,
  SEEDS_PER_PILE, WORLD_SEED,
} from './tuning.ts';

const SEED_PILE_ALONG = WORLD_SEED + 81;
const SEED_PILE_SIDE = WORLD_SEED + 82;
const SEED_SCATTER_ALONG = WORLD_SEED + 83;
const SEED_SCATTER_SIDE = WORLD_SEED + 84;
const SEED_SIZE = WORLD_SEED + 85;
const SEED_KIND = WORLD_SEED + 86;
const SEED_LOOK = WORLD_SEED + 87;
const SEED_COLOR = WORLD_SEED + 88;
const SEED_COLOR_2 = WORLD_SEED + 89;
const SEED_PATTERN = WORLD_SEED + 90;
/** Keep a seed's centre this far (metres) beyond a rock's surface. */
const ROCK_CLEARANCE = 1.2;
/** Colours per kind of collectible (kept in step with render/colors.ts, which a test checks). */
export const COLORS_PER_KIND = 6;
export const SEED_COUNT = SEED_PILES * SEEDS_PER_PILE;

/** Overshoot of the sprout's pop (the standard "ease out back" constant). */
const POP_OVERSHOOT = 1.70158;

/** A seed in flight, or the collectible it has become. */
export type Planted = {
  alive: boolean;
  /** Where it was thrown from and where it lands. */
  fromX: number; fromY: number; fromZ: number;
  x: number; y: number; z: number;
  radius: number;
  kind: number; look: number; color: number; color2: number; seed: number;
  /** Seconds since it left (negative while it waits its turn), and how long its flight takes. */
  age: number;
  flight: number;
  /** Peak height of the arc above the straight line, in metres. */
  arc: number;
};

export type SeedField = { items: Planted[]; next: number };

export function createSeedField(): SeedField {
  return {
    items: Array.from({ length: MAX_PLANTED }, () => ({
      alive: false, fromX: 0, fromY: 0, fromZ: 0, x: 0, y: 0, z: 0, radius: 0,
      kind: 0, look: 0, color: 0, color2: 0, seed: 0, age: 0, flight: 1, arc: 0,
    })),
    next: 0,
  };
}

export function clearSeeds(field: SeedField): void {
  for (const item of field.items) item.alive = false;
  field.next = 0;
}

export function livingSeeds(field: SeedField): number {
  let count = 0;
  for (const item of field.items) if (item.alive) count++;
  return count;
}

const rock = createRock();
const holeScratch = createHazardSample();

/** True if (x, z) is on a rock or too close to one. */
export function nearRock(x: number, z: number): boolean {
  const cellX = rockCellIndex(x), cellZ = rockCellIndex(z);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!rockInCell(cellX + dx, cellZ + dz, rock)) continue;
      if (Math.hypot(x - rock.x, z - rock.z) < rock.radius + ROCK_CLEARANCE) return true;
    }
  }
  return false;
}

/**
 * The next free place for a seed: one that is not in use (collected, expired or never used). Only when every place is taken does the
 * oldest seed give way, so a new packet never wipes out one that is still in the air or sprouting.
 */
function takeSlot(field: SeedField): Planted {
  for (let tried = 0; tried < MAX_PLANTED; tried++) {
    const index = (field.next + tried) % MAX_PLANTED;
    if (!field.items[index].alive) { field.next = (index + 1) % MAX_PLANTED; return field.items[index]; }
  }
  const item = field.items[field.next];
  field.next = (field.next + 1) % MAX_PLANTED;
  return item;
}

/**
 * Throw a spray of seeds from the jelly at (fromX, fromY, fromZ). `packetKey`
 * identifies the packet (any integer unique to it) so the same packet always
 * sprays the same pattern. Returns how many seeds were planted.
 */
export function plantSeeds(field: SeedField, fromX: number, fromY: number, fromZ: number, packetKey: number): number {
  const s0 = -fromZ;
  const jellySide = fromX - courseCenter(s0);
  let planted = 0;
  for (let pile = 0; pile < SEED_PILES; pile++) {
    const along = s0 + SEED_NEAR + (SEED_FAR - SEED_NEAR) * ((pile + hash2(packetKey, pile, SEED_PILE_ALONG) * 0.7) / SEED_PILES);
    const halfWidth = courseHalfWidth(along) * SEED_VALLEY_FRACTION;
    const wanted = (hash2(packetKey, pile, SEED_PILE_SIDE) * 2 - 1) * halfWidth * 0.6;
    const pileSide = SEED_LATERAL_PULL * Math.max(-halfWidth, Math.min(halfWidth, jellySide)) + (1 - SEED_LATERAL_PULL) * wanted;
    for (let n = 0; n < SEEDS_PER_PILE; n++) {
      const index = pile * SEEDS_PER_PILE + n;
      let s = 0, side = 0, found = false;
      // A few tries to find a spot that is not on a rock.
      for (let attempt = 0; attempt < SEED_PLACEMENT_TRIES && !found; attempt++) {
        const key = index * SEED_PLACEMENT_TRIES + attempt;
        s = along + (hash2(packetKey, key, SEED_SCATTER_ALONG) * 2 - 1) * SEED_PILE_RADIUS;
        const limit = courseHalfWidth(s) * SEED_VALLEY_FRACTION;
        side = Math.max(-limit, Math.min(limit, pileSide + (hash2(packetKey, key, SEED_SCATTER_SIDE) * 2 - 1) * SEED_PILE_RADIUS));
        found = !nearRock(courseCenter(s) + side, -s) && hazardAt(side, s, courseHalfWidth(s), holeScratch) === 0;
      }
      if (!found) continue;
      const item = takeSlot(field);
      const size = hash2(packetKey, index, SEED_SIZE);
      item.radius = MUSHROOM_MIN_RADIUS + (MUSHROOM_MAX_RADIUS - MUSHROOM_MIN_RADIUS) * (SEED_MIN_SIZE_SHARE + (1 - SEED_MIN_SIZE_SHARE) * size);
      item.x = courseCenter(s) + side;
      item.z = -s;
      item.y = terrainHeight(item.x, item.z) + item.radius * MUSHROOM_REST_HEIGHT;
      // What it sprouts into depends on the ground it landed on.
      item.kind = collectibleKind(s, hash2(packetKey, index, SEED_KIND));
      item.look = pickLook(item.kind, hash2(packetKey, index, SEED_LOOK));
      item.color = Math.floor(hash2(packetKey, index, SEED_COLOR) * COLORS_PER_KIND);
      item.color2 = (item.color + 1 + Math.floor(hash2(packetKey, index, SEED_COLOR_2) * (COLORS_PER_KIND - 1))) % COLORS_PER_KIND;
      item.seed = hash2(packetKey, index, SEED_PATTERN);
      item.fromX = fromX; item.fromY = fromY; item.fromZ = fromZ;
      const distance = Math.hypot(item.x - fromX, item.z - fromZ);
      item.flight = SEED_FLIGHT_MIN_SECONDS + distance * SEED_FLIGHT_SECONDS_PER_METRE;
      item.arc = distance * SEED_ARC_HEIGHT_PER_METRE;
      // They leave one after another, in a spray, not all at once.
      item.age = -SEED_STAGGER_SECONDS * (index / SEED_COUNT);
      item.alive = true;
      planted++;
    }
  }
  return planted;
}

/** Advance every seed's clock, and drop ones that were never collected or are far behind. */
export function advanceSeeds(field: SeedField, dt: number, jellyZ: number): void {
  for (const item of field.items) {
    if (!item.alive) continue;
    item.age += dt;
    // Larger z is further up the course, i.e. behind a jelly that travels toward -z.
    if (item.age > item.flight + SEED_LIFETIME_SECONDS || item.z > jellyZ + SEED_BEHIND_DISTANCE) item.alive = false;
  }
}

/** True while a seed is still in the air. */
export function inFlight(item: Planted): boolean {
  return item.age >= 0 && item.age < item.flight;
}

/** 0 until the seed lands, then how grown its collectible is: up to 1, with a little overshoot on the way. */
export function sproutScale(item: Planted): number {
  if (item.age < item.flight) return 0;
  const t = Math.min(1, (item.age - item.flight) / SEED_GROW_SECONDS);
  const c = POP_OVERSHOOT, u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/** Where a flying seed is, written into `out` as x, y, z. */
export function seedPosition(item: Planted, out: { x: number; y: number; z: number }): void {
  const u = Math.max(0, Math.min(1, item.age / item.flight));
  out.x = item.fromX + (item.x - item.fromX) * u;
  out.z = item.fromZ + (item.z - item.fromZ) * u;
  out.y = item.fromY + (item.y - item.fromY) * u + item.arc * 4 * u * (1 - u);
}
