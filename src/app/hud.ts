/** The few numbers on screen: the score (distance covered), speed, the jelly's size, and the best score. */
import { BIOMES, biomeBlend, biomeOfStretch, biomeStretch, dominantBiome, wearScale } from '../game/biomes.ts';
import { ballSpeed, type Ball } from '../game/physics.ts';
import { KMH_PER_MS, MIN_RADIUS, START_RADIUS } from '../game/tuning.ts';

const METRES_PER_KILOMETRE = 1000;
const REFRESH_SECONDS = 0.1;
const CENTIMETRES_PER_METRE = 100;
/** Below this fraction of the way from gone to fresh, the size readout warns. */
const LOW_SIZE_FRACTION = 0.35;
const BANNER_SECONDS = 3.5;

/** The blended wear rate at `s` without the per-loop increase, to recover that increase from wearScale. */
function blendedBase(s: number) {
  const stretch = biomeStretch(s);
  const from = BIOMES[biomeOfStretch(stretch)].wear, to = BIOMES[biomeOfStretch(stretch + 1)].wear;
  return from + (to - from) * biomeBlend(s, stretch);
}
const BEST_STORAGE_KEY = 'jellyland.best-distance';

export class Hud {
  private readonly distance = document.querySelector<HTMLElement>('#distance')!;
  private readonly speed = document.querySelector<HTMLElement>('#speed')!;
  private readonly best = document.querySelector<HTMLElement>('#best')!;
  private readonly hints = document.querySelector<HTMLElement>('#hints')!;
  private readonly size = document.querySelector<HTMLElement>('#size')!;
  private readonly merges = document.querySelector<HTMLElement>('#merges')!;
  private readonly air = document.querySelector<HTMLElement>('#air')!;
  private readonly finalAir = document.querySelector<HTMLElement>('#final-air')!;
  private readonly biome = document.querySelector<HTMLElement>('#biome')!;
  private readonly banner = document.querySelector<HTMLElement>('#biome-banner')!;
  private readonly bannerName = document.querySelector<HTMLElement>('#biome-banner-name')!;
  private readonly bannerWear = document.querySelector<HTMLElement>('#biome-banner-wear')!;
  private shownBiome = -1;
  private bannerSeconds = 0;
  private readonly magnet = document.querySelector<HTMLElement>('#magnet')!;
  private readonly magnetSeconds = document.querySelector<HTMLElement>('#magnet-seconds')!;
  private readonly wornOut = document.querySelector<HTMLElement>('#worn-out')!;
  private readonly finalDistance = document.querySelector<HTMLElement>('#final-distance')!;
  private bestDistance = readBest();
  private sinceRefresh = REFRESH_SECONDS;

  update(ball: Ball, helpShown: boolean, dt: number) {
    // Not rate-limited with the numbers: help should answer the key press at once.
    this.hints.classList.toggle('shown', helpShown);
    const distance = ball.distance, speed = ballSpeed(ball);
    this.sinceRefresh += dt;
    this.bannerSeconds = Math.max(0, this.bannerSeconds - dt);
    if (this.sinceRefresh < REFRESH_SECONDS) return;
    this.sinceRefresh = 0;
    this.showBiome(-ball.z);
    if (distance > this.bestDistance) this.bestDistance = distance;
    this.distance.textContent = formatDistance(distance);
    this.speed.textContent = Math.round(speed * KMH_PER_MS).toString();
    this.best.textContent = formatDistance(this.bestDistance);
    // Diameter, because that is the size you see.
    this.size.textContent = `${Math.round(ball.radius * 2 * CENTIMETRES_PER_METRE)} cm`;
    const life = (ball.radius - MIN_RADIUS) / (START_RADIUS - MIN_RADIUS);
    this.size.parentElement!.classList.toggle('low', life < LOW_SIZE_FRACTION);
    this.merges.textContent = ball.merges.toString();
    this.air.textContent = formatSeconds(ball.airSeconds);
    this.magnet.classList.toggle('shown', ball.magnetSeconds > 0);
    this.magnetSeconds.textContent = formatSeconds(ball.magnetSeconds);
    this.wornOut.classList.toggle('shown', ball.wornOut);
    if (ball.wornOut) {
      this.finalDistance.textContent = formatDistance(distance);
      this.finalAir.textContent = formatSeconds(ball.airSeconds);
    }
  }

  /** Keep the biome label current, and announce each new biome for a few seconds as the jelly crosses into it. */
  private showBiome(s: number) {
    const index = dominantBiome(s);
    const wear = `wear ×${wearScale(s).toFixed(1)}`;
    this.biome.textContent = `${BIOMES[index].name} · ${wear}`;
    if (index !== this.shownBiome) {
      // The very first biome is not news; every later one is.
      if (this.shownBiome !== -1) {
        this.bannerName.textContent = BIOMES[index].name;
        this.bannerWear.textContent = `wear ×${(BIOMES[index].wear * (wearScale(s) / blendedBase(s))).toFixed(1)}`;
        this.bannerSeconds = BANNER_SECONDS;
      }
      this.shownBiome = index;
    }
    this.banner.classList.toggle('shown', this.bannerSeconds > 0);
  }

  /** Persist the best distance; called on restart and when the page is hidden. */
  save() {
    try { localStorage.setItem(BEST_STORAGE_KEY, String(Math.floor(this.bestDistance))); } catch { /* private mode: nothing to keep */ }
  }
}

function readBest(): number {
  try {
    const stored = Number(localStorage.getItem(BEST_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : 0;
  } catch {
    return 0;
  }
}

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(1)} s`;
}

function formatDistance(metres: number): string {
  if (metres < METRES_PER_KILOMETRE) return `${Math.floor(metres)} m`;
  return `${(metres / METRES_PER_KILOMETRE).toFixed(2)} km`;
}
