/**
 * Fog events in the scree. Each stretch of scree has an even chance of one: it starts somewhere from half way through the biome
 * (and always finishes inside it), lasts FOG_LENGTH metres, and leaves between a half and a tenth of the usual visibility. Like the
 * rest of the world it is a pure function of the course, so a given stretch always has the same fog (or none).
 */
import { BIOME_LENGTH, SCREE, biomeOfStretch } from './biomes.ts';
import { hash2, smoothstep } from './noise.ts';
import {
  FOG_CHANCE, FOG_EARLIEST_SHARE, FOG_LENGTH, FOG_RAMP, FOG_VISIBILITY_THICKEST, FOG_VISIBILITY_THINNEST, WORLD_SEED,
} from './tuning.ts';

const FOG_HAPPENS = WORLD_SEED + 301;
const FOG_WHERE = WORLD_SEED + 302;
const FOG_THICKNESS = WORLD_SEED + 303;
const NO_FOG = 1;

export type FogEvent = {
  /** Course distance where it begins and ends. */
  from: number;
  to: number;
  /** Share of normal visibility left at its thickest. */
  visibility: number;
};

/** The fog event of the biome stretch `stretch`, written into `out`; false if that stretch is not scree or has no fog. */
export function fogEventOf(stretch: number, out: FogEvent): boolean {
  if (stretch < 0 || biomeOfStretch(stretch) !== SCREE) return false;
  if (hash2(stretch, 0, FOG_HAPPENS) >= FOG_CHANCE) return false;
  const earliest = BIOME_LENGTH * FOG_EARLIEST_SHARE, latest = BIOME_LENGTH - FOG_LENGTH;
  out.from = stretch * BIOME_LENGTH + earliest + (latest - earliest) * hash2(stretch, 0, FOG_WHERE);
  out.to = out.from + FOG_LENGTH;
  out.visibility = FOG_VISIBILITY_THICKEST + (FOG_VISIBILITY_THINNEST - FOG_VISIBILITY_THICKEST) * hash2(stretch, 0, FOG_THICKNESS);
  return true;
}

const event: FogEvent = { from: 0, to: 0, visibility: 1 };

/** Share of normal visibility at course distance `s`: 1 in clear air, less inside a fog event (which eases in and out at its ends). */
export function fogVisibilityAt(s: number): number {
  if (!fogEventOf(Math.floor(s / BIOME_LENGTH), event)) return NO_FOG;
  if (s <= event.from || s >= event.to) return NO_FOG;
  const inside = smoothstep(event.from, event.from + FOG_RAMP, s) * (1 - smoothstep(event.to - FOG_RAMP, event.to, s));
  return NO_FOG - (NO_FOG - event.visibility) * inside;
}
