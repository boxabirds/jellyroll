/**
 * Turns what hazards take from the jelly (melting, stabs, burns; not plain rolling wear) into the occasional "-N cm"
 * the player sees: losses are added up and reported once they come to
 * DAMAGE_POPUP_MIN_CM of diameter, and no more often than DAMAGE_POPUP_GAP_SECONDS.
 */
import { DAMAGE_POPUP_GAP_SECONDS, DAMAGE_POPUP_MIN_CM } from './tuning.ts';

const CENTIMETRES_PER_METRE = 100;
const DIAMETER_PER_RADIUS = 2;

export class DamageNumbers {
  private cm = 0;
  private since = DAMAGE_POPUP_GAP_SECONDS;

  /** @param radiusLost metres of radius lost since the last call, and `dt` seconds since the last call; returns whole centimetres of diameter to show, or 0 for nothing yet */
  step(radiusLost: number, dt: number): number {
    this.cm += radiusLost * DIAMETER_PER_RADIUS * CENTIMETRES_PER_METRE;
    this.since += dt;
    if (this.cm < DAMAGE_POPUP_MIN_CM || this.since < DAMAGE_POPUP_GAP_SECONDS) return 0;
    const shown = Math.floor(this.cm);
    this.cm -= shown;
    this.since = 0;
    return shown;
  }

  reset() {
    this.cm = 0;
    this.since = DAMAGE_POPUP_GAP_SECONDS;
  }
}
