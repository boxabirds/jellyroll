/**
 * The "critically low" warning: when the jelly has worn down to almost nothing
 * it pulses red, faster the closer it is to gone. Pure functions, so the
 * thresholds can be tested; the drawing is in world/ and app/.
 */
import { MIN_RADIUS, START_RADIUS } from './tuning.ts';

/** Critical below this fraction of the way from "gone" to a fresh jelly's radius. */
export const CRITICAL_LIFE_FRACTION = 0.25;
/** Pulses per second just inside the critical zone, and when nearly gone. */
export const PULSE_HZ_SLOW = 1.4;
export const PULSE_HZ_FAST = 3.4;
/** How red the steady (no-flashing) version is, as a share of the full strength. */
export const STEADY_LEVEL = 0.7;

/** 0 while the jelly is healthy; rises to 1 as its radius falls from the critical threshold to nothing. */
export function criticalSeverity(radius: number): number {
  const threshold = MIN_RADIUS + CRITICAL_LIFE_FRACTION * (START_RADIUS - MIN_RADIUS);
  if (radius >= threshold) return 0;
  return Math.min(1, (threshold - radius) / (threshold - MIN_RADIUS));
}

export function pulseRate(severity: number): number {
  return PULSE_HZ_SLOW + (PULSE_HZ_FAST - PULSE_HZ_SLOW) * severity;
}

/** Advances the pulse and returns how red to show things now, 0..1. Silent when healthy or already gone. */
export class Alarm {
  /** 0..1 now: severity times the pulse. */
  level = 0;
  /** Severity alone, steady: for things that should stay red rather than flash. */
  severity = 0;
  /** True for people who have asked for less motion: the warning stays on, steady, instead of flashing. */
  steady = false;
  private phase = 0;

  update(radius: number, wornOut: boolean, dt: number) {
    this.severity = wornOut ? 0 : criticalSeverity(radius);
    if (this.severity === 0) { this.level = 0; this.phase = 0; return; }
    if (this.steady) { this.level = this.severity * STEADY_LEVEL; return; }
    this.phase = (this.phase + pulseRate(this.severity) * dt) % 1;
    // A sharp beat, like a heartbeat, not a gentle sine: rises quickly and falls away.
    const beat = Math.sin(Math.PI * this.phase);
    this.level = this.severity * (0.35 + 0.65 * beat * beat);
  }

  reset() {
    this.level = 0; this.severity = 0; this.phase = 0;
  }
}
