/**
 * The little jellies scattered down the valley. Like rocks they are never
 * stored: each cell answers from a hash whether it holds one and what it looks
 * like. The only state is the ledger of which ones the player has absorbed.
 */
import { collectibleKind, collectibleScale, CAVE, ICE, MEADOW, DUNES, SCREE, LAVA } from './biomes.ts';
import { createHazardSample, hazardAt } from './hazards.ts';
import { hash2, smoothstep, valueNoise2 } from './noise.ts';
import { courseCenter, courseHalfWidth, terrainHeight } from './terrain.ts';
import {
  MUSHROOM_CELL,
  MUSHROOM_COLOR_COUNT,
  MUSHROOM_EDGE_MARGIN,
  MUSHROOM_FREE_UNTIL,
  MUSHROOM_LEDGER_SIZE,
  MUSHROOM_MAX_RADIUS,
  MUSHROOM_MIN_RADIUS,
  MUSHROOM_PATCH_DENSITY,
  MUSHROOM_PATCH_FEATHER,
  MUSHROOM_PATCH_THRESHOLD,
  MUSHROOM_PATCH_WAVELENGTH,
  MUSHROOM_REST_HEIGHT,
  WORLD_SEED,
} from './tuning.ts';

const holeScratch = createHazardSample();
const SEED_EXISTS = WORLD_SEED + 41;
const SEED_OFFSET_X = WORLD_SEED + 42;
const SEED_OFFSET_Z = WORLD_SEED + 43;
const SEED_RADIUS = WORLD_SEED + 44;
const SEED_LOOK = WORLD_SEED + 45;
const SEED_COLOR = WORLD_SEED + 46;
const SEED_COLOR_2 = WORLD_SEED + 47;
const SEED_SHAPE = WORLD_SEED + 48;
const SEED_PATCH = WORLD_SEED + 49;
const SEED_KIND = WORLD_SEED + 50;

/** Look ids, in the order of LOOKS in render/jelly-looks.ts (a test keeps the two in step). */
export const LOOK = {
  classic: 0, zebra: 1, spotty: 2, stripy: 3, swirly: 4, sprinkle: 5, checked: 6, twoTone: 7, glitter: 8, rainbow: 9, galaxy: 10, golden: 11,
} as const;
const ALL_LOOKS = Object.values(LOOK);
/**
 * The collectibles of each biome, by kind: jelly mushrooms in the meadow,
 * snowballs on the ice, cacti in the dunes, crystals in the scree, embers
 * on the lava. Each kind only comes in the looks that suit it.
 */
export const KIND_NAMES: readonly string[] = [];
(KIND_NAMES as string[])[MEADOW] = 'mushroom';
(KIND_NAMES as string[])[ICE] = 'snowball';
(KIND_NAMES as string[])[DUNES] = 'cactus';
(KIND_NAMES as string[])[SCREE] = 'ore';
(KIND_NAMES as string[])[LAVA] = 'ember';
(KIND_NAMES as string[])[CAVE] = 'crystal';
const KIND_LOOKS: readonly (readonly number[])[] = [];
(KIND_LOOKS as number[][])[ICE] = [LOOK.classic, LOOK.classic, LOOK.glitter];
(KIND_LOOKS as number[][])[MEADOW] = ALL_LOOKS;
(KIND_LOOKS as number[][])[DUNES] = [LOOK.classic, LOOK.stripy, LOOK.spotty];
/** Ore: plain metal, glittering metal, and the play of colour of an opal. */
(KIND_LOOKS as number[][])[SCREE] = [LOOK.classic, LOOK.glitter, LOOK.rainbow];
(KIND_LOOKS as number[][])[LAVA] = [LOOK.classic, LOOK.golden, LOOK.swirly];
(KIND_LOOKS as number[][])[CAVE] = [LOOK.classic, LOOK.glitter, LOOK.galaxy, LOOK.twoTone];

/** One of the looks a kind of collectible comes in, chosen by `chance` (0..1). */
export function pickLook(kind: number, chance: number): number {
  const looks = KIND_LOOKS[kind];
  return looks[Math.min(looks.length - 1, Math.floor(chance * looks.length))];
}

export type Mushroom = {
  x: number; y: number; z: number; radius: number;
  /** What it is: the index of the biome it grows in (see KIND_NAMES). */
  kind: number;
  /** Index into the looks list (classic, zebra, spotty, ...). */
  look: number;
  /** Indices into its kind's palette: main colour and pattern colour. */
  color: number; color2: number;
  /** 0..1, varies the shape, pattern and wobble phase. */
  seed: number;
};

export function createMushroom(): Mushroom {
  return { x: 0, y: 0, z: 0, radius: 0, kind: 0, look: 0, color: 0, color2: 0, seed: 0 };
}

export function mushroomCellIndex(coordinate: number): number {
  return Math.floor(coordinate / MUSHROOM_CELL);
}

/** Chance that a cell at (x, s) holds a mushroom: patches with bare ground between. */
export function mushroomDensity(x: number, s: number): number {
  if (s < MUSHROOM_FREE_UNTIL) return 0;
  const patch = valueNoise2(x / MUSHROOM_PATCH_WAVELENGTH, s / MUSHROOM_PATCH_WAVELENGTH, SEED_PATCH);
  return MUSHROOM_PATCH_DENSITY * collectibleScale(s) * smoothstep(MUSHROOM_PATCH_THRESHOLD, MUSHROOM_PATCH_THRESHOLD + MUSHROOM_PATCH_FEATHER, patch);
}

/** Fills `out` with the mushroom of cell (cellX, cellZ); false when the cell is empty. */
export function mushroomInCell(cellX: number, cellZ: number, out: Mushroom): boolean {
  const x = (cellX + hash2(cellX, cellZ, SEED_OFFSET_X)) * MUSHROOM_CELL;
  const z = (cellZ + hash2(cellX, cellZ, SEED_OFFSET_Z)) * MUSHROOM_CELL;
  const s = -z;
  if (hash2(cellX, cellZ, SEED_EXISTS) >= mushroomDensity(x, s)) return false;
  if (Math.abs(x - courseCenter(s)) > courseHalfWidth(s) - MUSHROOM_EDGE_MARGIN) return false;
  // Nothing grows in a hole.
  if (hazardAt(x - courseCenter(s), s, courseHalfWidth(s), holeScratch) > 0) return false;
  // Squaring favours small mushrooms; the occasional big one is a prize.
  const size = hash2(cellX, cellZ, SEED_RADIUS);
  const radius = MUSHROOM_MIN_RADIUS + (MUSHROOM_MAX_RADIUS - MUSHROOM_MIN_RADIUS) * size * size;
  const color = Math.floor(hash2(cellX, cellZ, SEED_COLOR) * MUSHROOM_COLOR_COUNT);
  // The pattern colour is always a different sweet from the main one.
  const step = 1 + Math.floor(hash2(cellX, cellZ, SEED_COLOR_2) * (MUSHROOM_COLOR_COUNT - 1));
  out.x = x; out.z = z; out.radius = radius;
  out.y = terrainHeight(x, z) + radius * MUSHROOM_REST_HEIGHT;
  out.kind = collectibleKind(s, hash2(cellX, cellZ, SEED_KIND));
  const looks = KIND_LOOKS[out.kind];
  out.look = looks[Math.floor(hash2(cellX, cellZ, SEED_LOOK) * looks.length)];
  out.color = color;
  out.color2 = (color + step) % MUSHROOM_COLOR_COUNT;
  out.seed = hash2(cellX, cellZ, SEED_SHAPE);
  return true;
}

/**
 * Which mushrooms have been absorbed. A fixed ring: the jelly only ever moves
 * downhill, so by the time an entry is overwritten its cell is far behind.
 */
export type MushroomLedger = { cells: Int32Array; cursor: number; total: number };

export function createMushroomLedger(): MushroomLedger {
  return { cells: new Int32Array(MUSHROOM_LEDGER_SIZE * 2).fill(Number.MIN_SAFE_INTEGER | 0), cursor: 0, total: 0 };
}

export function resetMushroomLedger(ledger: MushroomLedger): void {
  ledger.cells.fill(Number.MIN_SAFE_INTEGER | 0);
  ledger.cursor = 0;
  ledger.total = 0;
}

export function isMushroomTaken(ledger: MushroomLedger, cellX: number, cellZ: number): boolean {
  const { cells } = ledger;
  const used = Math.min(ledger.total, MUSHROOM_LEDGER_SIZE) * 2;
  for (let i = 0; i < used; i += 2) if (cells[i] === cellX && cells[i + 1] === cellZ) return true;
  return false;
}

export function takeMushroom(ledger: MushroomLedger, cellX: number, cellZ: number): void {
  ledger.cells[ledger.cursor * 2] = cellX;
  ledger.cells[ledger.cursor * 2 + 1] = cellZ;
  ledger.cursor = (ledger.cursor + 1) % MUSHROOM_LEDGER_SIZE;
  ledger.total++;
}
