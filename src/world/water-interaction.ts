/**
 * What the jelly does to the water: a splash when it goes in or lands in it (a dent, foam, and spray), and a wake while it
 * wades. The water's own physics are in water/ (sim.ts for the ripples, spray.ts for what is thrown up).
 */
import { CAVE, DUNES, ICE, LAVA, MEADOW, SCREE } from '../game/biomes.ts';
import { isLiquidKind } from '../game/hazards.ts';
import type { Ball } from '../game/physics.ts';
import { waterSettings } from '../water/params.ts';
import type { WaterSim } from '../water/sim.ts';
import type { WaterSpray } from '../water/spray.ts';

/** How strongly each kind of liquid ripples, by biome index: water fully, icy water less, the rest not at all. */
export const RIPPLE_BY_BIOME: readonly number[] = (() => {
  const strength: number[] = [];
  strength[MEADOW] = 1; strength[ICE] = 0.6; strength[DUNES] = 1; strength[SCREE] = 0; strength[LAVA] = 0; strength[CAVE] = 1;
  return strength;
})();
/** Speed (m/s) at which a splash reaches full strength, and the slowest landing that splashes at all. */
const FULL_STRENGTH_SPEED = 12;
const MIN_LANDING_SPEED = 3;
const MIN_ENTRY_STRENGTH = 0.3;
/** The jelly is "in the water" once this deep in a water hole. */
const IN_WATER_DEPTH = 0.3;
/** The size of the splash relative to the jelly. */
const SPLASH_RADIUS_PER_JELLY_RADIUS = 1.1;
/** The dent a splash digs: its width and depth per metre of splash radius, and the foam it leaves. */
const DENT_WIDTH = 1.3;
const DENT_DEPTH_BASE = 0.25;
const DENT_DEPTH_PER_STRENGTH = 0.9;
const FOAM_WIDTH = 1.5;
const FOAM_BASE = 0.35;
const FOAM_PER_STRENGTH = 0.5;
const FOAM_MAX = 0.85;
/** While wading: a wake every this many seconds, its dent per m/s, its foam per m/s (up to a cap), and the slowest that leaves one. */
const WAKE_GAP_SECONDS = 0.05;
const WAKE_DEPTH_PER_SPEED = 0.012;
const WAKE_RADIUS_PER_JELLY_RADIUS = 0.9;
const WAKE_FOAM_PER_SPEED = 0.08;
const WAKE_FOAM_MAX = 0.6;
const WAKE_MIN_SPEED = 0.6;

export class WaterInteraction {
  enabled = true;
  private wasInWater = false;
  private wakeClock = 0;

  constructor(private readonly sim: WaterSim, private readonly spray: WaterSpray) {}

  reset() {
    this.wasInWater = false;
    this.sim.reset();
    this.spray.reset();
  }

  /** A splash at (x, z) of a thing of `radius`, `strength` 0..1, moving (vx, vz). */
  splash(x: number, z: number, level: number, strength: number, vx: number, vz: number, radius: number, kindFactor: number) {
    const v = waterSettings.values;
    const s = strength * kindFactor;
    this.sim.drop(x, z, radius * v.dropRadius * DENT_WIDTH, -radius * v.dropStrength * (DENT_DEPTH_BASE + DENT_DEPTH_PER_STRENGTH * s));
    this.sim.addFoam(x, z, radius * FOAM_WIDTH * v.dropRadius, Math.min(FOAM_MAX, v.foamAmount * (FOAM_BASE + FOAM_PER_STRENGTH * s)));
    this.spray.splash(x, z, level, s, vx, vz, radius);
  }

  /** Feed the jelly's doings into the water. */
  update(ball: Ball, dt: number) {
    if (!this.enabled) return;
    const speed = Math.hypot(ball.vx, ball.vz);
    const kindFactor = RIPPLE_BY_BIOME[ball.hazardKind] ?? 0;
    const inWater = ball.grounded && ball.hazardDepth > IN_WATER_DEPTH && isLiquidKind(ball.hazardKind) && kindFactor > 0;
    const speedShare = Math.min(1, speed / FULL_STRENGTH_SPEED);
    const radius = ball.radius * SPLASH_RADIUS_PER_JELLY_RADIUS;
    if (inWater && !this.wasInWater) {
      this.splash(ball.x, ball.z, ball.hazardLevel, Math.max(MIN_ENTRY_STRENGTH, speedShare), ball.vx, ball.vz, radius, kindFactor);
    } else if (inWater && speed > WAKE_MIN_SPEED) {
      this.wakeClock += dt;
      if (this.wakeClock >= WAKE_GAP_SECONDS) {
        this.wakeClock = 0;
        const v = waterSettings.values;
        this.sim.drop(ball.x, ball.z, ball.radius * WAKE_RADIUS_PER_JELLY_RADIUS, -WAKE_DEPTH_PER_SPEED * speed * v.wakeStrength * kindFactor);
        this.sim.addFoam(ball.x, ball.z, ball.radius * WAKE_RADIUS_PER_JELLY_RADIUS, Math.min(WAKE_FOAM_MAX, WAKE_FOAM_PER_SPEED * speed) * v.foamAmount * kindFactor);
      }
    }
    if (inWater && ball.impact > MIN_LANDING_SPEED) {
      this.splash(ball.x, ball.z, ball.hazardLevel, Math.min(1, ball.impact / FULL_STRENGTH_SPEED), ball.vx, ball.vz, radius, kindFactor);
    }
    this.wasInWater = inWater;
  }
}
