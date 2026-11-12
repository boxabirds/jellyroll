/** A distance as the game shows it: metres below a kilometre, kilometres above. */
export const METRES_PER_KILOMETRE = 1000;

export function formatDistance(metres: number): string {
  if (metres < METRES_PER_KILOMETRE) return `${Math.floor(metres)} m`;
  return `${(metres / METRES_PER_KILOMETRE).toFixed(2)} km`;
}
