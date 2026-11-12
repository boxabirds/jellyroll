/** The few numbers on screen: the score (distance covered), speed, the jelly's size, and the best score. */
import { BIOMES, biomeBlend, biomeOfStretch, biomeStretch, dominantBiome, snowAt, wearScale } from '../game/biomes.ts';
import { ballSpeed, type Ball } from '../game/physics.ts';
import { KMH_PER_MS, MIN_RADIUS, START_RADIUS } from '../game/tuning.ts';

const METRES_PER_KILOMETRE = 1000;
const REFRESH_SECONDS = 0.1;
const CENTIMETRES_PER_METRE = 100;
/** Below this fraction of the way from gone to fresh, the size readout warns. */
const LOW_SIZE_FRACTION = 0.35;
const BANNER_SECONDS = 3.5;
const TOAST_SECONDS = 2.4;
/** A warning stays up long enough to read, and is given each time the jelly comes onto snow (once at least this much of the ground is snow). */
const WARNING_SECONDS = 7;
const SNOW_WARNING_FROM = 0.2;
export const SNOW_WARNING = 'Warning! Snow sticks to jelly, limits control. Slow down to shake it off';
/** The size readout flashes when it has grown by more than this many centimetres since the last refresh. */
const GROWTH_PULSE_CM = 0;

/** The blended wear rate at `s` without the per-loop increase, to recover that increase from wearScale. */
function blendedBase(s: number) {
  const stretch = biomeStretch(s);
  const from = BIOMES[biomeOfStretch(stretch)].wear, to = BIOMES[biomeOfStretch(stretch + 1)].wear;
  return from + (to - from) * biomeBlend(s, stretch);
}
const PERCENT = 100;
const BEST_STORAGE_KEY = 'jellyland.best-distance';

export class Hud {
  private readonly distance = document.querySelector<HTMLElement>('#distance')!;
  private readonly speed = document.querySelector<HTMLElement>('#speed')!;
  private readonly best = document.querySelector<HTMLElement>('#best')!;
  private readonly hints = document.querySelector<HTMLElement>('#hints')!;
  private readonly size = document.querySelector<HTMLElement>('#size')!;
  private readonly merges = document.querySelector<HTMLElement>('#merges')!;
  private readonly snow = document.querySelector<HTMLElement>('#snow')!;
  private readonly air = document.querySelector<HTMLElement>('#air')!;
  private readonly finalAir = document.querySelector<HTMLElement>('#final-air')!;
  private readonly banner = document.querySelector<HTMLElement>('#biome-banner')!;
  private readonly bannerName = document.querySelector<HTMLElement>('#biome-banner-name')!;
  private readonly bannerWear = document.querySelector<HTMLElement>('#biome-banner-wear')!;
  private readonly toastElement = document.querySelector<HTMLElement>('#toast')!;
  private readonly alarmElement = document.querySelector<HTMLElement>('#alarm')!;
  private toastSeconds = 0;
  private readonly warningElement = document.querySelector<HTMLElement>('#warning')!;
  private warningSeconds = 0;
  private onSnow = false;
  private shownBiome = -1;
  private lastCentimetres = 0;
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
    this.toastSeconds = Math.max(0, this.toastSeconds - dt);
    this.toastElement.classList.toggle('shown', this.toastSeconds > 0);
    this.warningSeconds = Math.max(0, this.warningSeconds - dt);
    this.warningElement.classList.toggle('shown', this.warningSeconds > 0);
    if (this.sinceRefresh < REFRESH_SECONDS) return;
    this.sinceRefresh = 0;
    this.showBiome(-ball.z);
    if (distance > this.bestDistance) this.bestDistance = distance;
    this.distance.textContent = formatDistance(distance);
    this.speed.textContent = Math.round(speed * KMH_PER_MS).toString();
    this.best.textContent = formatDistance(this.bestDistance);
    // Diameter, because that is the size you see.
    const centimetres = Math.round(ball.radius * 2 * CENTIMETRES_PER_METRE);
    this.size.textContent = `${centimetres} cm`;
    // A flash on the readout each time the jelly gets bigger.
    if (centimetres > this.lastCentimetres + GROWTH_PULSE_CM) {
      const stat = this.size.parentElement!;
      stat.classList.remove('grew'); void stat.offsetWidth; stat.classList.add('grew');
    }
    this.lastCentimetres = centimetres;
    const life = (ball.radius - MIN_RADIUS) / (START_RADIUS - MIN_RADIUS);
    this.size.parentElement!.classList.toggle('low', life < LOW_SIZE_FRACTION);
    this.merges.textContent = ball.merges.toString();
    this.snow.textContent = `${Math.round(ball.snow * PERCENT)}%`;
    this.air.textContent = formatSeconds(ball.airSeconds);
    this.magnet.classList.toggle('shown', ball.magnetSeconds > 0);
    this.magnetSeconds.textContent = formatSeconds(ball.magnetSeconds);
    this.wornOut.classList.toggle('shown', ball.wornOut);
    if (ball.wornOut) {
      this.finalDistance.textContent = formatDistance(distance);
      this.finalAir.textContent = formatSeconds(ball.airSeconds);
    }
  }

  /** The critically-low warning: the screen edges and the size readout flush red with `level` (0..1). */
  setAlarm(level: number, active: boolean) {
    this.alarmElement.style.setProperty('--alarm', level.toFixed(3));
    const stat = this.size.parentElement!;
    stat.style.setProperty('--alarm', level.toFixed(3));
    stat.classList.toggle('critical', active);
  }

  /** A short message under the scores, for a few seconds. */
  toast(text: string) {
    this.toastElement.textContent = text;
    this.toastSeconds = TOAST_SECONDS;
    this.toastElement.classList.add('shown');
  }

  /** A warning that stays up for a few seconds. */
  warn(text: string) {
    this.warningElement.textContent = text;
    this.warningSeconds = WARNING_SECONDS;
  }

  /** Announce each new biome for a few seconds as the jelly crosses into it. */
  private showBiome(s: number) {
    const snowy = snowAt(s) >= SNOW_WARNING_FROM;
    if (snowy && !this.onSnow) this.warn(SNOW_WARNING);
    this.onSnow = snowy;
    const index = dominantBiome(s);
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
