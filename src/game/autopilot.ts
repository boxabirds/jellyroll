/**
 * Steering for the demo: the jelly rolls itself. It heads for the nearest collectible it can reach, steers round rocks, keeps to the
 * middle of the valley otherwise (with a slow weave so it is not a straight line), and can be told to hold a line instead (to roll
 * through a pond). It reads the same world the jelly does.
 */
import { createHazardSample, hazardAt } from './hazards.ts';
import { createMushroom, isMushroomTaken, mushroomCellIndex, mushroomInCell } from './mushrooms.ts';
import type { Ball } from './physics.ts';
import { createRock, isRockBroken, rockCellIndex, rockInCell } from './rocks.ts';
import { courseCenter, courseDrift, courseHalfWidth } from './terrain.ts';
import { MUSHROOM_CELL, ROCK_CELL } from './tuning.ts';

/** Collectibles this far ahead (metres) are worth steering for; nearer ones are too late to reach. */
const SEEK_MIN = 5;
const SEEK_MAX = 38;
/** A collectible is reachable if it is within this share of its distance ahead, plus a margin, to the side. */
const REACH_SHARE = 0.35;
const REACH_MARGIN = 2;
/** Cost of sideways distance against distance ahead, so straighter lines are preferred. */
const SIDE_COST = 1.5;
/** How far (cells each side of the course) collectibles are looked for. */
const SEEK_CELLS_ACROSS = 6;
/** Rocks this far ahead are steered round, with this much room over the radii. */
const ROCK_LOOKAHEAD = 42;
const ROCK_ROOM = 2.2;
/** A rock is judged against where the jelly will be as it gets there: on its way from where it is to the target over this many metres. */
const PATH_BLEND = 20;
/** A glass marble prefers bigger rocks: each metre of radius is worth this many metres of distance. */
const ROCK_APPEAL = 4;
/** The jelly stays within this share of the valley's half width of its middle. */
const KEEP_IN = 0.45;
/** How much of that room the idle weave uses, and how quickly it turns (radians a second). */
const WEAVE_SHARE = 0.35;
const WEAVE_RATE = 0.4;
/**
 * Steering works on the sideways speed, not the position (the jelly turns like a car, so steering on position alone swings it
 * wide): the sideways speed wanted is GAIN times the distance to the target, at most LATERAL_SHARE of the speed, and the steer is
 * TRIM times what is missing.
 */
const GAIN = 0.4;
const LATERAL_SHARE = 0.25;
const TRIM = 0.15;

/** Holes in the ground are steered round: the path is checked at these distances ahead, and the nearest clear line within these offsets is taken. */
const HOLE_LOOKAHEAD = [6, 12, 18, 26];
const HOLE_DODGES = [3, -3, 6, -6, 9, -9];
/** A hole line only counts as clear when it is this shallow in total, and straying from the wanted line costs this much per metre. */
const HOLE_CLEAR = 0.05;
const STRAY_COST = 0.03;

const mushroom = createMushroom();
const hole = createHazardSample();
const rock = createRock();

/** How much hole there is along a line `u` metres off the middle, over the next stretch. */
function holeAlong(s: number, u: number): number {
  let total = 0;
  for (const ahead of HOLE_LOOKAHEAD) total += hazardAt(u, s + ahead, courseHalfWidth(s + ahead), hole);
  return total;
}

/** The steer (-1 left, 1 right) that takes `ball` where the demo wants it. `lane`, when set, is a fixed offset from the course centre to hold. */
export function autoSteer(ball: Ball, clock: number, lane: number | null = null): number {
  const s = -ball.z, centre = courseCenter(s), limit = courseHalfWidth(s) * KEEP_IN;
  let target = lane !== null ? centre + lane : centre + Math.sin(clock * WEAVE_RATE) * limit * WEAVE_SHARE;
  if (lane === null) {
    let best = Infinity;
    const cellZ = mushroomCellIndex(ball.z), rows = Math.ceil(SEEK_MAX / MUSHROOM_CELL);
    for (let z = cellZ - rows; z <= cellZ - 1; z++) {
      const rowCentre = mushroomCellIndex(courseCenter(-(z + 0.5) * MUSHROOM_CELL));
      for (let x = rowCentre - SEEK_CELLS_ACROSS; x <= rowCentre + SEEK_CELLS_ACROSS; x++) {
        if (!mushroomInCell(x, z, mushroom) || isMushroomTaken(ball.ledger, x, z)) continue;
        const ahead = ball.z - mushroom.z, side = mushroom.x - ball.x;
        if (ahead < SEEK_MIN || ahead > SEEK_MAX || Math.abs(side) > REACH_SHARE * ahead + REACH_MARGIN) continue;
        const cost = ahead + Math.abs(side) * SIDE_COST;
        if (cost < best) { best = cost; target = mushroom.x; }
      }
    }
  }
  const rockZ = rockCellIndex(ball.z), rockX = rockCellIndex(ball.x), rockRows = Math.ceil(ROCK_LOOKAHEAD / ROCK_CELL);
  if (ball.glassSeconds > 0 && lane === null) {
    // A glass marble goes for the rocks: it smashes whatever it can reach.
    let best = Infinity;
    for (let z = rockZ - rockRows; z <= rockZ; z++) {
      for (let x = rockX - 2; x <= rockX + 2; x++) {
        if (!rockInCell(x, z, rock) || isRockBroken(ball.brokenRocks, x, z)) continue;
        const ahead = ball.z - rock.z, side = rock.x - ball.x;
        if (ahead < SEEK_MIN || ahead > ROCK_LOOKAHEAD || Math.abs(side) > REACH_SHARE * ahead + REACH_MARGIN) continue;
        const cost = ahead + Math.abs(side) * SIDE_COST - rock.radius * ROCK_APPEAL;
        if (cost < best) { best = cost; target = rock.x; }
      }
    }
  } else {
    // Rocks in the way: aim past the nearest one on whichever side has more room.
    let nearest = Infinity;
    for (let z = rockZ - rockRows; z <= rockZ; z++) {
      for (let x = rockX - 2; x <= rockX + 2; x++) {
        if (!rockInCell(x, z, rock) || isRockBroken(ball.brokenRocks, x, z)) continue;
        const ahead = ball.z - rock.z, room = rock.radius + ball.radius + ROCK_ROOM;
        if (ahead < 0 || ahead > ROCK_LOOKAHEAD || ahead >= nearest) continue;
        const pathX = ball.x + (target - ball.x) * Math.min(1, ahead / PATH_BLEND);
        if (Math.abs(rock.x - pathX) > room) continue;
        nearest = ahead;
        target = rock.x + (pathX >= rock.x ? room : -room);
      }
    }
  }
  if (lane === null && ball.glassSeconds <= 0 && holeAlong(s, target - centre) > HOLE_CLEAR) {
    let bestCost = Infinity, bestTarget = target;
    for (const dodge of HOLE_DODGES) {
      const line = Math.max(-limit, Math.min(limit, target - centre + dodge));
      const cost = holeAlong(s, line) + Math.abs(line - (target - centre)) * STRAY_COST;
      if (cost < bestCost) { bestCost = cost; bestTarget = centre + line; }
    }
    target = bestTarget;
  }
  target = Math.max(centre - limit, Math.min(centre + limit, target));
  const speed = Math.max(Math.hypot(ball.vx, ball.vz), 1);
  // The course itself drifts sideways as it goes down the valley; what matters is the speed across it.
  const courseVx = courseDrift(s) * -ball.vz;
  const wanted = courseVx + Math.max(-LATERAL_SHARE * speed, Math.min(LATERAL_SHARE * speed, (target - ball.x) * GAIN));
  return Math.max(-1, Math.min(1, (wanted - ball.vx) * TRIM));
}
