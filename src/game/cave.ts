/**
 * The cave: a tunnel through a hill. For the whole of the cave biome a rock ceiling arches over the valley from bank to
 * bank; the course runs into it through a mouth in a hillside and out the other end. This is its shape, as pure
 * functions, shared by what draws it and by the stalactites that hang from it.
 */
import { caveDepth, caveStart } from './biomes.ts';
import { valueNoise2 } from './noise.ts';
import { courseCenter, courseHalfWidth, terrainHeight } from './terrain.ts';
import { WORLD_SEED } from './tuning.ts';

/**
 * It is a cavern, not a tunnel: far wider than the valley floor and many times as high, and nothing about it is regular.
 * Its roof is a broad vault whose height swells and sags along the way and from side to side, hung with lumps and
 * hollows of every size; its highest part wanders off the centre line. These are the sizes (metres).
 */
export const CAVE_HEIGHT = 46;
/** The vault is this much higher or lower from place to place, in swells about this far across. */
const VAULT_SWELL = 16;
const VAULT_SWELL_SPAN = 85;
/** Its walls come down this far beyond the valley floor. */
export const CAVE_WALL_REACH = 48;
/** The roof's lumps: big ones and small ones (height, and how far across). */
const LUMP_BIG = 6;
const LUMP_BIG_SPAN = 23;
const LUMP_SMALL = 2.2;
const LUMP_SMALL_SPAN = 7;
/** The highest part of the vault wanders this far either side of the centre line, over about this distance. */
const VAULT_WANDER = 16;
const VAULT_WANDER_SPAN = 120;
/** The vault is flatter than a half circle: this power of the circle's height. */
const ARCH_FLATNESS = 0.8;
const SEED_CEILING = WORLD_SEED + 261;
/** The floor is looked at every this many metres of course, at this many points either side of the centre, out to this far beyond the valley floor. */
const REF_ROW = 6;
const REF_SAMPLES = 4;
const REF_REACH = 14;
const REF_SLOTS = 1024;
/** However the vault sags, it is never lower than this over the floor at its crown (and in proportion elsewhere). */
const VAULT_LEAST = 30;

export { caveStart };

/** True under the roof. */
export function insideCave(s: number): boolean {
  return caveDepth(s) >= 0;
}

/** Half the width of the tunnel at `s`: where its walls meet the floor's level. */
export function caveHalfSpan(s: number): number {
  return courseHalfWidth(s) + CAVE_WALL_REACH;
}

/** How high the plain vault is over a point `u` metres across from the centre line, given the half span: 0 at the walls. */
export function archHeight(u: number, halfSpan: number): number {
  const t = u / halfSpan;
  return t * t >= 1 ? 0 : Math.pow(1 - t * t, ARCH_FLATNESS / 2);
}

/** Height of the roof over (x, s), given the height it is measured up from there (see floorRef; many points of one row can share it). */
export function ceilingOver(x: number, s: number, centreFloor: number): number {
  const half = caveHalfSpan(s);
  // The crown of the vault is off to one side or the other, and the whole vault is higher here and lower there.
  const crown = (valueNoise2(s / VAULT_WANDER_SPAN, 3.7, SEED_CEILING + 1) - 0.5) * 2 * VAULT_WANDER;
  const shape = archHeight(x - courseCenter(s) - crown * (1 - Math.abs(x - courseCenter(s)) / half), half);
  if (shape <= 0) return centreFloor;
  const swell = (valueNoise2(x / VAULT_SWELL_SPAN, s / VAULT_SWELL_SPAN, SEED_CEILING + 2) - 0.5) * 2 * VAULT_SWELL;
  const lumps =
    (valueNoise2(x / LUMP_BIG_SPAN, s / LUMP_BIG_SPAN, SEED_CEILING + 3) - 0.5) * 2 * LUMP_BIG +
    (valueNoise2(x / LUMP_SMALL_SPAN, s / LUMP_SMALL_SPAN, SEED_CEILING) - 0.5) * 2 * LUMP_SMALL;
  // The lumps die away toward the walls, where the roof comes down to the ground.
  return centreFloor + Math.max(shape * VAULT_LEAST, shape * (CAVE_HEIGHT + swell) + lumps * Math.min(1, shape * 2));
}

/** Height of the roof over (x, s). */
export function ceilingHeight(x: number, s: number): number {
  return ceilingOver(x, s, floorRef(s));
}

const refRow = new Int32Array(REF_SLOTS).fill(-1);
const refValue = new Float64Array(REF_SLOTS);

/** The highest the floor gets across the valley at one of the rows the roof is measured from. Remembered, since many points ask. */
function rowRef(row: number): number {
  const slot = ((row % REF_SLOTS) + REF_SLOTS) % REF_SLOTS;
  if (refRow[slot] === row) return refValue[slot];
  const s = row * REF_ROW, centre = courseCenter(s), reach = courseHalfWidth(s) + REF_REACH;
  let highest = Number.NEGATIVE_INFINITY;
  for (let k = -REF_SAMPLES; k <= REF_SAMPLES; k++) highest = Math.max(highest, terrainHeight(centre + (k / REF_SAMPLES) * reach, -s));
  refRow[slot] = row; refValue[slot] = highest;
  return highest;
}

/**
 * The height the roof is measured up from at `s`: the highest point of the floor across the valley there (not the height
 * of the centre line, which a hill on one side can stand well above), so the roof clears all the ground under it.
 */
export function floorRef(s: number): number {
  const row = Math.floor(s / REF_ROW), part = s / REF_ROW - row;
  const here = rowRef(row), next = rowRef(row + 1);
  return here + (next - here) * part;
}
