/**
 * The ground the freeze ray has changed this run: round patches of frozen lake, blackened lava and cooled lava ground. Held here, with
 * nothing imported, so the terrain can ask "is this frozen?" without a cycle. The patches live as long as the run does.
 */
export type FrostKind = 'ice' | 'crust' | 'cool';

export interface Frost {
  id: number;
  x: number;
  z: number;
  radius: number;
  kind: FrostKind;
  /** Height of the surface the patch lies on (the lake's level, or the ground there). */
  level: number;
}

export const frostPatches: Frost[] = [];

/** Patches kept: once there are this many the oldest goes (and the water or lava it covered comes back). */
export const MAX_FROSTS = 40;

let nextId = 1;
export const newFrostId = () => nextId++;

/** Take every patch away (a new run). */
export function clearFrost(): void {
  frostPatches.length = 0;
}

/** The patch covering (x, z), if there is one. */
export function frostAt(x: number, z: number): Frost | null {
  for (let i = 0; i < frostPatches.length; i++) {
    const patch = frostPatches[i];
    const dx = x - patch.x, dz = z - patch.z;
    if (dx * dx + dz * dz < patch.radius * patch.radius) return patch;
  }
  return null;
}

/** Frozen lakes and cooled lava are solid: the ground inside such a patch comes up to the patch's level, easing in over this width at its rim. */
export const FROST_RIM = 0.9;

/** `height` there, lifted to the surface of any frozen lake or lava crust covering (x, z). */
export function frozenHeight(x: number, z: number, height: number): number {
  let result = height;
  for (let i = 0; i < frostPatches.length; i++) {
    const patch = frostPatches[i];
    if (patch.kind === 'cool' || patch.level <= result) continue;
    const dx = x - patch.x, dz = z - patch.z;
    const inside = patch.radius - Math.sqrt(dx * dx + dz * dz);
    if (inside <= 0) continue;
    const t = Math.min(1, inside / FROST_RIM);
    result += (patch.level - result) * t * t * (3 - 2 * t);
  }
  return result;
}
