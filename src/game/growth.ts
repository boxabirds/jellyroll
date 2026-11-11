/**
 * How much a merge makes the jelly grow, as the player sees it: the change in
 * the jelly's diameter, the size the HUD shows.
 */
const CENTIMETRES_PER_METRE = 100;
/** Below this many centimetres of growth a merge is shown as having no effect (the jelly is at its size limit). */
export const MIN_VISIBLE_GROWTH_CM = 0.5;

/** @param jellyRadius radius just before the merge  @param volume volume the merge added */
export function growthCentimetres(jellyRadius: number, volume: number): number {
  const after = Math.cbrt(jellyRadius ** 3 + volume);
  return 2 * (after - jellyRadius) * CENTIMETRES_PER_METRE;
}
