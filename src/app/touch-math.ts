/**
 * The maths behind the touch controls, with no page or sensor code, so it can
 * be tested: turning a thumb position into stick values, and turning the
 * phone's orientation into a left/right tilt that is correct however the
 * phone is held.
 */

/** A thumb within this fraction of the stick's travel from its centre counts as centred. */
export const STICK_DEADZONE = 0.12;

export type StickValue = { x: number; y: number };

/**
 * @param dx,dy   thumb position from the stick's centre, in pixels (y grows downward, as on screen)
 * @param maxRadius pixels of travel that mean "fully pushed"
 * @returns x: -1 (left) to 1 (right); y: -1 (down) to 1 (up), eased out from the dead zone
 */
export function stickValue(dx: number, dy: number, maxRadius: number, out: StickValue): StickValue {
  const length = Math.hypot(dx, dy);
  if (length < 1e-9 || maxRadius <= 0) { out.x = 0; out.y = 0; return out; }
  const pushed = Math.min(1, length / maxRadius);
  // Past the dead zone, rescale so the value still reaches 1 at full travel and rises smoothly from 0.
  const eased = pushed <= STICK_DEADZONE ? 0 : (pushed - STICK_DEADZONE) / (1 - STICK_DEADZONE);
  // `+ 0` turns a negative zero into a plain zero.
  out.x = (dx / length) * eased + 0;
  out.y = (-dy / length) * eased + 0;
  return out;
}

const RADIANS_PER_DEGREE = Math.PI / 180;
const DEGREES_PER_RADIAN = 180 / Math.PI;

/**
 * How far the screen is rolled to the right (its right edge lower than its left), in degrees,
 * from the phone's DeviceOrientation angles, whatever way up the phone is held or rotated.
 *
 * Gravity in the phone's own frame is (cos b sin g, -sin b, -cos b cos g); the screen's right
 * edge points along (cos a, -sin a, 0) for a screen rotated `screenAngle` degrees. The roll is
 * the part of gravity along that edge. (Unlike reading `gamma` directly, this stays correct
 * when the phone is held upright or turned sideways, where gamma flips or saturates.)
 */
export function screenRoll(betaDegrees: number, gammaDegrees: number, screenAngleDegrees: number): number {
  const beta = betaDegrees * RADIANS_PER_DEGREE, gamma = gammaDegrees * RADIANS_PER_DEGREE;
  const angle = screenAngleDegrees * RADIANS_PER_DEGREE;
  const sideways = Math.cos(beta) * Math.sin(gamma) * Math.cos(angle) + Math.sin(beta) * Math.sin(angle);
  return Math.asin(Math.max(-1, Math.min(1, sideways))) * DEGREES_PER_RADIAN;
}

/** Tilt (degrees from the held-still position) inside which the jelly is not steered. */
export const TILT_DEADZONE_DEGREES = 3;
/** Tilt (degrees from the held-still position) that steers as hard as possible. */
export const TILT_FULL_DEGREES = 24;

/** Steering, -1 (left) to 1 (right), for a roll relative to the roll the player started from. */
export function tiltSteer(rollDegrees: number, neutralDegrees: number): number {
  const tilt = rollDegrees - neutralDegrees;
  const size = Math.abs(tilt);
  if (size <= TILT_DEADZONE_DEGREES) return 0;
  const eased = Math.min(1, (size - TILT_DEADZONE_DEGREES) / (TILT_FULL_DEGREES - TILT_DEADZONE_DEGREES));
  return Math.sign(tilt) * eased;
}
