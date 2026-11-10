/**
 * The jelly feel. The rigid ball in physics.ts decides where the jelly goes;
 * this adds two damped springs on top of it that decide what shape it is:
 * a squash along the ground normal (kicked by landings and rock hits) and a
 * lean that lags behind acceleration. Underdamped on purpose, so it wobbles.
 */
import { clamp } from './noise.ts';
import type { Ball } from './physics.ts';

const TAU = Math.PI * 2;
const SQUASH_FREQUENCY_HZ = 5.5;
const SQUASH_DAMPING_RATIO = 0.2;
/** Resting compression while sitting on the ground, as a fraction of radius. */
const SQUASH_GROUNDED = 0.07;
/** Slight elongation while in the air. */
const SQUASH_AIRBORNE = -0.035;
/** Squash velocity (1/s) gained per m/s of impact. */
const SQUASH_IMPACT_GAIN = 0.85;
const ROCK_IMPACT_GAIN = 0.6;
/** Squash velocity (1/s) taken off by a jump, and added per merged mushroom of the jelly's own size. */
const JUMP_STRETCH_KICK = 5;
const MERGE_KICK = 7;
const SQUASH_MIN = -0.28;
const SQUASH_MAX = 0.5;

const LEAN_FREQUENCY_HZ = 4;
const LEAN_DAMPING_RATIO = 0.25;
/** Lean (fraction of radius) per m/s² of horizontal acceleration. */
const LEAN_PER_ACCEL = 0.011;
const LEAN_MAX = 0.3;
/** Rate (1/s) at which the contact patch grows and shrinks. */
const CONTACT_RATE = 18;

export type Wobble = {
  /** Compression along the ground normal; positive is flatter. */
  squash: number;
  squashVelocity: number;
  /** Top-of-jelly offset in world X/Z as a fraction of radius. */
  leanX: number; leanZ: number;
  leanVelocityX: number; leanVelocityZ: number;
  /** 0 airborne, 1 resting on the ground; smoothed. */
  contact: number;
  previousVx: number; previousVz: number;
};

export function createWobble(): Wobble {
  return {
    squash: 0, squashVelocity: 0, leanX: 0, leanZ: 0, leanVelocityX: 0, leanVelocityZ: 0,
    contact: 0, previousVx: 0, previousVz: 0,
  };
}

export function resetWobble(wobble: Wobble, ball: Ball): void {
  wobble.squash = 0; wobble.squashVelocity = 0;
  wobble.leanX = 0; wobble.leanZ = 0; wobble.leanVelocityX = 0; wobble.leanVelocityZ = 0;
  wobble.contact = 0;
  wobble.previousVx = ball.vx; wobble.previousVz = ball.vz;
}

/** Advance the springs by one physics step. Call after stepBall. */
export function stepWobble(wobble: Wobble, ball: Ball, dt: number): void {
  const squashOmega = TAU * SQUASH_FREQUENCY_HZ;
  wobble.squashVelocity += ball.impact * SQUASH_IMPACT_GAIN + ball.rockImpact * ROCK_IMPACT_GAIN;
  // A hop stretches the jelly as it leaves; each merge lands like a soft thump.
  if (ball.jumped) wobble.squashVelocity -= JUMP_STRETCH_KICK;
  for (let i = 0; i < ball.pickupCount; i++) wobble.squashVelocity += MERGE_KICK * ball.pickups[i].radius / ball.radius;
  const squashRest = ball.grounded ? SQUASH_GROUNDED : SQUASH_AIRBORNE;
  const squashAccel =
    -squashOmega * squashOmega * (wobble.squash - squashRest) -
    2 * SQUASH_DAMPING_RATIO * squashOmega * wobble.squashVelocity;
  wobble.squashVelocity += squashAccel * dt;
  wobble.squash += wobble.squashVelocity * dt;
  if (wobble.squash < SQUASH_MIN || wobble.squash > SQUASH_MAX) {
    wobble.squash = clamp(wobble.squash, SQUASH_MIN, SQUASH_MAX);
    wobble.squashVelocity = 0;
  }

  // The body lags behind its own acceleration, like a pudding on a plate.
  const accelX = (ball.vx - wobble.previousVx) / dt;
  const accelZ = (ball.vz - wobble.previousVz) / dt;
  wobble.previousVx = ball.vx; wobble.previousVz = ball.vz;
  const targetX = clamp(-accelX * LEAN_PER_ACCEL, -LEAN_MAX, LEAN_MAX);
  const targetZ = clamp(-accelZ * LEAN_PER_ACCEL, -LEAN_MAX, LEAN_MAX);
  const leanOmega = TAU * LEAN_FREQUENCY_HZ;
  const leanDamping = 2 * LEAN_DAMPING_RATIO * leanOmega;
  wobble.leanVelocityX += (-leanOmega * leanOmega * (wobble.leanX - targetX) - leanDamping * wobble.leanVelocityX) * dt;
  wobble.leanVelocityZ += (-leanOmega * leanOmega * (wobble.leanZ - targetZ) - leanDamping * wobble.leanVelocityZ) * dt;
  wobble.leanX = clamp(wobble.leanX + wobble.leanVelocityX * dt, -LEAN_MAX, LEAN_MAX);
  wobble.leanZ = clamp(wobble.leanZ + wobble.leanVelocityZ * dt, -LEAN_MAX, LEAN_MAX);

  const contactTarget = ball.grounded ? 1 : 0;
  wobble.contact += (contactTarget - wobble.contact) * Math.min(1, CONTACT_RATE * dt);
}
