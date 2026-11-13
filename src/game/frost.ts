/**
 * The freeze ray: sprays ice in front of the jelly. Where that lands on a lake the lake freezes (ice), on a lava lake the lava goes black
 * and cold (a crust), and on the lava biome's ground it cools; the lava lake and the frozen lake stop hurting. Everywhere else the ice
 * is only for show. The patches are put in frost-store.ts, where the terrain looks for them.
 */
import { BIOME_COUNT, LAVA, dominantBiome } from './biomes.ts';
import { frostPatches, frostAt, MAX_FROSTS, newFrostId, type Frost } from './frost-store.ts';
import { createHazardSample, isLiquidKind } from './hazards.ts';
import { holeEffectAt, holeLevel, terrainHeight } from './terrain.ts';
import { FREEZE_DISTANCES, FREEZE_PATCH_RADIUS, FREEZE_SIDES } from './tuning.ts';

const sample = createHazardSample();

/** A wet point is one where there is really water or lava (the hole's rim is dry ground). */
const WET = 0.25;
/** A patch looks at its middle and at points this share of its radius out, all round, for something to freeze. */
const PROBES = 9;
const PROBE_REACH = 0.7;
/** A new patch is not put this close (in patch radii) to one already there. */
const OVERLAP = 0.8;

/**
 * Freeze the ground in front of (x, z), heading (dirX, dirZ). The patches made are added to the store and also put in `made`, so the
 * game can show the steam and play the sounds. Returns how many were made.
 */
export function freezeAhead(x: number, z: number, dirX: number, dirZ: number, made: Frost[]): number {
  made.length = 0;
  const length = Math.hypot(dirX, dirZ) || 1;
  const forwardX = dirX / length, forwardZ = dirZ / length;
  const rightX = -forwardZ, rightZ = forwardX;
  for (const ahead of FREEZE_DISTANCES) {
    for (const side of FREEZE_SIDES) {
      const cx = x + forwardX * ahead + rightX * side, cz = z + forwardZ * ahead + rightZ * side;
      const patch = patchAt(cx, cz);
      if (!patch) continue;
      if (frostPatches.some(other => (other.x - cx) ** 2 + (other.z - cz) ** 2 < (FREEZE_PATCH_RADIUS * OVERLAP) ** 2 && other.kind === patch.kind)) continue;
      if (frostPatches.length >= MAX_FROSTS) frostPatches.shift();
      frostPatches.push(patch);
      made.push(patch);
    }
  }
  return made.length;
}

/** What freezing (cx, cz) does there, or null for nothing lasting. */
function patchAt(cx: number, cz: number): Frost | null {
  if (frostAt(cx, cz)) return null;
  // Water or lava anywhere under the patch (its middle first, then points round it) is what it lands on: the patch is moved onto it.
  for (let probe = 0; probe < PROBES; probe++) {
    const angle = (probe / (PROBES - 1)) * Math.PI * 2;
    const reach = probe === 0 ? 0 : FREEZE_PATCH_RADIUS * PROBE_REACH;
    const x = cx + Math.cos(angle) * reach, z = cz + Math.sin(angle) * reach;
    if (probe > 0 && frostAt(x, z)) continue;
    const effect = holeEffectAt(x, z, sample);
    if (effect > WET && isLiquidKind(sample.kind)) {
      return { id: newFrostId(), x, z, radius: FREEZE_PATCH_RADIUS, kind: sample.kind === LAVA ? 'crust' : 'ice', level: holeLevel(sample) };
    }
  }
  if (dominantBiome(-cz) === LAVA && BIOME_COUNT > 0) return { id: newFrostId(), x: cx, z: cz, radius: FREEZE_PATCH_RADIUS, kind: 'cool', level: terrainHeight(cx, cz) };
  return null;
}
