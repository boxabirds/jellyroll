/**
 * What the water costs, set by one number: "processor intensity" (0..100). It picks one of four tiers and scales the
 * spray within a tier. Every cost in the water is a line here, so the cheapest setting really is cheap:
 *  - the ripple grid: how many cells (the work per step goes with the square) and how often it is stepped and uploaded
 *  - the surface: how many triangles, whether the ripples lift it, and how many reads of the scene each pixel makes
 *  - the surface shader: noise layers and the second refraction check
 *  - the spray: droplets, crown, jet, mist, the finer drops and the ripples from landings
 */
import { waterSettings } from './params.ts';

export type Quality = {
  tier: 0 | 1 | 2 | 3;
  name: string;
  /** Ripple grid: cells across, and how many times a second it is stepped (always enough to look smooth; a coarser grid just has bigger cells). */
  simCells: number;
  simHz: number;
  /** The surface grid: segments across. */
  gridSegments: number;
  /** Ripples lift the surface itself (a vertex texture read), not only tilt its shading. */
  lift: boolean;
  /** The view is bent by the surface and checked against the depth behind (two more depth reads a pixel). */
  bentRefraction: boolean;
  /** The second, finer layer of waves, and of foam breakup. */
  fineDetail: boolean;
  /** Droplets: how many of the default, and the most alive at once. */
  dropletScale: number;
  dropletCap: number;
  crown: boolean;
  jet: boolean;
  mist: boolean;
  /** Big drops break into finer ones on landing, and every drop that lands makes a ripple and foam. */
  fineDrops: boolean;
  landingRipples: boolean;
};

const TIERS: Omit<Quality, 'dropletScale' | 'dropletCap'>[] = [
  { tier: 0, name: 'Minimal', simCells: 48, simHz: 30, gridSegments: 32, lift: false, bentRefraction: false, fineDetail: false, crown: false, jet: false, mist: false, fineDrops: false, landingRipples: false },
  { tier: 1, name: 'Low', simCells: 80, simHz: 30, gridSegments: 64, lift: true, bentRefraction: false, fineDetail: false, crown: true, jet: false, mist: false, fineDrops: false, landingRipples: true },
  { tier: 2, name: 'Medium', simCells: 128, simHz: 40, gridSegments: 128, lift: true, bentRefraction: true, fineDetail: false, crown: true, jet: true, mist: false, fineDrops: true, landingRipples: true },
  { tier: 3, name: 'High', simCells: 160, simHz: 60, gridSegments: 176, lift: true, bentRefraction: true, fineDetail: true, crown: true, jet: true, mist: true, fineDrops: true, landingRipples: true },
];
/** Intensity at which each tier starts. */
const TIER_FROM = [0, 20, 45, 75];
const MAX_DROPLETS = 600;

export function qualityFor(intensity: number): Quality {
  let tier = 0;
  for (let i = 0; i < TIER_FROM.length; i++) if (intensity >= TIER_FROM[i]) tier = i;
  const from = TIER_FROM[tier], to = tier + 1 < TIER_FROM.length ? TIER_FROM[tier + 1] : 100;
  const along = Math.max(0, Math.min(1, (intensity - from) / Math.max(1, to - from)));
  // Inside a tier the spray grows from this tier's share to the next's.
  const shares = [0.15, 0.4, 0.75, 1];
  const next = shares[Math.min(3, tier + 1)];
  const dropletScale = shares[tier] + (next - shares[tier]) * along * (tier === 3 ? 0 : 0.9);
  return { ...TIERS[tier], dropletScale, dropletCap: Math.max(40, Math.round(MAX_DROPLETS * dropletScale)) };
}

export function currentQuality(): Quality {
  return qualityFor(waterSettings.values.intensity);
}
