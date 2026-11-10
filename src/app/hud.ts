/** The few numbers on screen: the score (distance covered), speed, the jelly's size, and the best score. */
import { ballSpeed, type Ball } from '../game/physics.ts';
import { MIN_RADIUS, START_RADIUS } from '../game/tuning.ts';

const METRES_PER_KILOMETRE = 1000;
const KMH_PER_MS = 3.6;
const REFRESH_SECONDS = 0.1;
const CENTIMETRES_PER_METRE = 100;
/** Below this fraction of the way from gone to fresh, the size readout warns. */
const LOW_SIZE_FRACTION = 0.35;
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
  private readonly wornOut = document.querySelector<HTMLElement>('#worn-out')!;
  private readonly finalDistance = document.querySelector<HTMLElement>('#final-distance')!;
  private bestDistance = readBest();
  private sinceRefresh = REFRESH_SECONDS;

  update(ball: Ball, helpShown: boolean, dt: number) {
    // Not rate-limited with the numbers: help should answer the key press at once.
    this.hints.classList.toggle('shown', helpShown);
    const distance = ball.distance, speed = ballSpeed(ball);
    this.sinceRefresh += dt;
    if (this.sinceRefresh < REFRESH_SECONDS) return;
    this.sinceRefresh = 0;
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
    this.wornOut.classList.toggle('shown', ball.wornOut);
    if (ball.wornOut) {
      this.finalDistance.textContent = formatDistance(distance);
      this.finalAir.textContent = formatSeconds(ball.airSeconds);
    }
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
