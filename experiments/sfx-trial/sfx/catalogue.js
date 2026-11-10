/**
 * The effects the trial page offers, by name. Shared by the page and the
 * measurement script so both exercise exactly the same sounds.
 */
import {
  LANDING_INTENSITY, MERGE_RUN_GAP_S, MERGE_RUN_LENGTH, MERGE_RUN_SIZE, MUSHROOM_SIZE,
  jumpSquish, landingSquish, magnetPickup, mergePlop,
} from './jelly-sounds.js';

/** @typedef {import('./jelly-sounds.js').Layer} Layer */
/** @typedef {import('./jelly-sounds.js').Random} Random */

/** One merge after another, each a step higher. Returned as layers so it renders as a single sound. */
function mergeRun(/** @type {Random} */ random) {
  /** @type {Layer[]} */
  const layers = [];
  for (let step = 0; step < MERGE_RUN_LENGTH; step++) {
    for (const layer of mergePlop(MERGE_RUN_SIZE, step, random)) {
      layers.push({ ...layer, start: layer.start + step * MERGE_RUN_GAP_S });
    }
  }
  return layers;
}

/** @type {{ id: string, label: string, layers: (random: Random) => Layer[] }[]} */
export const EFFECTS = [
  { id: 'plop-small', label: 'Merge plop: small mushroom', layers: random => mergePlop(MUSHROOM_SIZE.small, 0, random) },
  { id: 'plop-medium', label: 'Merge plop: medium mushroom', layers: random => mergePlop(MUSHROOM_SIZE.medium, 0, random) },
  { id: 'plop-large', label: 'Merge plop: large mushroom', layers: random => mergePlop(MUSHROOM_SIZE.large, 0, random) },
  { id: 'merge-run', label: 'Run of 6 merges, climbing', layers: mergeRun },
  { id: 'jump', label: 'Jump', layers: jumpSquish },
  { id: 'landing-soft', label: 'Soft landing', layers: random => landingSquish(LANDING_INTENSITY.soft, random) },
  { id: 'landing-hard', label: 'Hard landing', layers: random => landingSquish(LANDING_INTENSITY.hard, random) },
  { id: 'magnet-pickup', label: 'Magnet pickup', layers: magnetPickup },
];
