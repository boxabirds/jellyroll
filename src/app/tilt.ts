/**
 * Tilt steering from the phone's orientation sensors. The first reading after
 * it is switched on (or after the screen turns) is "straight"; tilting the
 * phone left or right from there steers. The maths is in touch-math.ts.
 */
import { screenRoll, tiltSteer } from './touch-math.ts';

/** If no sensor reading arrives this soon after switching on, the device has no tilt sensor. */
const NO_SENSOR_AFTER_MS = 1500;

type PermissionedOrientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

function screenAngle(): number {
  return screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
}

export class TiltSensor {
  /** True while tilt steering is switched on and readings are coming in. */
  active = false;
  private roll = 0;
  private neutral = 0;
  private haveReading = false;
  private waiting = false;
  private timer = 0;

  constructor(private readonly onMessage: (text: string) => void) {}

  /** Switch on. Must be called from a tap: iPhones ask permission, and only allow the question from a gesture. */
  async enable(): Promise<boolean> {
    if (this.active || this.waiting) return this.active;
    if (!window.isSecureContext || typeof DeviceOrientationEvent === 'undefined') {
      this.onMessage('Tilt needs a phone with motion sensors, on a secure (https) page');
      return false;
    }
    const request = (DeviceOrientationEvent as PermissionedOrientation).requestPermission;
    if (request) {
      try {
        if ((await request.call(DeviceOrientationEvent)) !== 'granted') { this.onMessage('Motion access was refused, so tilt is off'); return false; }
      } catch {
        this.onMessage('Could not ask for motion access');
        return false;
      }
    }
    this.waiting = true;
    this.haveReading = false;
    window.addEventListener('deviceorientation', this.onReading);
    screen.orientation?.addEventListener('change', this.recenter);
    this.timer = window.setTimeout(() => {
      if (this.haveReading) return;
      this.disable();
      this.onMessage('No tilt sensor found on this device');
    }, NO_SENSOR_AFTER_MS);
    return true;
  }

  disable() {
    this.active = false; this.waiting = false;
    clearTimeout(this.timer);
    window.removeEventListener('deviceorientation', this.onReading);
    screen.orientation?.removeEventListener('change', this.recenter);
  }

  /** Call the tilt "straight" from the way the phone is held right now. */
  readonly recenter = () => {
    this.neutral = this.roll;
  };

  /** Steering, -1 to 1, from the latest reading. Zero while off. */
  steer(): number {
    return this.active ? tiltSteer(this.roll, this.neutral) : 0;
  }

  private readonly onReading = (event: DeviceOrientationEvent) => {
    if (event.beta === null || event.gamma === null) return;
    this.roll = screenRoll(event.beta, event.gamma, screenAngle());
    if (!this.haveReading) {
      this.haveReading = true;
      this.neutral = this.roll;
      this.active = true;
      this.waiting = false;
      this.onMessage('Tilt steering on: the way you hold the phone now is straight');
    }
  };
}
