/** Small ZzFX sounds for the glass marble, the bees and the shields (see sfx-sounds.ts for the layer format). */
import type { Layer, Random } from './sfx-sounds.ts';

const SHAPE_SINE = 0;
const SHAPE_SAW = 2;
const SHAPE_NOISE = 4;
const PITCH_JITTER = 0.04;
/** The raw layers of a rock knock sum to well over full scale; this brings the hardest to about 0.8. */
const STONE_LEVEL = 0.27;
const jitter = (random: Random, amount: number) => 1 + (random() * 2 - 1) * amount;

/** Picking up the glass marble: a fingertip tapping the rim of a wine glass. A tiny tick, then a pure ring that hangs and slowly dies, with a faint beat between two nearly equal tones, as a real glass has. */
export function glassPickup(random: Random = Math.random): Layer[] {
  const root = 1180 * jitter(random, PITCH_JITTER);
  return [
    { start: 0, gain: 0.16, zzfx: { frequency: 4200, shape: SHAPE_NOISE, attack: 0, release: 0.012, filter: 1500 } },
    { start: 0, gain: 0.42, zzfx: { frequency: root, shape: SHAPE_SINE, attack: 0.001, release: 1.9 } },
    { start: 0, gain: 0.3, zzfx: { frequency: root * 1.0028, shape: SHAPE_SINE, attack: 0.001, release: 1.6 } },
    { start: 0, gain: 0.16, zzfx: { frequency: root * 2.71, shape: SHAPE_SINE, attack: 0.001, release: 0.7 } },
    { start: 0, gain: 0.06, zzfx: { frequency: root * 5.1, shape: SHAPE_SINE, attack: 0.001, release: 0.3 } },
  ];
}

/** Finding a bee: a buzzy zip that rises, then two quick wing-beats. */
export function beePickup(random: Random = Math.random): Layer[] {
  const root = 260 * jitter(random, PITCH_JITTER);
  return [
    { start: 0, gain: 0.3, zzfx: { frequency: root, shape: SHAPE_SAW, attack: 0.01, sustain: 0.16, release: 0.2, slide: 1.6, modulation: 40 } },
    { start: 0.07, gain: 0.2, zzfx: { frequency: root * 2, shape: SHAPE_SAW, attack: 0.01, sustain: 0.1, release: 0.15, slide: 1.2, modulation: 55 } },
    { start: 0.22, gain: 0.3, zzfx: { frequency: root * 3, shape: SHAPE_SINE, attack: 0.005, release: 0.3 } },
  ];
}

/** A shield or the bees levelling up: a quick rising run of four notes. */
export function levelUp(random: Random = Math.random): Layer[] {
  const root = 523 * jitter(random, PITCH_JITTER);
  return [1, 1.26, 1.5, 2].map((ratio, i) => ({
    start: i * 0.075, gain: 0.34, zzfx: { frequency: root * ratio, shape: SHAPE_SINE, attack: 0.004, sustain: 0.02, release: i === 3 ? 0.55 : 0.18 },
  }));
}

/**
 * Hard rock hitting hard rock, for the glass marble's collisions (`intensity` 0..1): a sharp crack that is mostly the
 * broken-off edge of the sound, a dense "thock" body, and a short dry ring of the stone itself. No bounce, no ring-out:
 * rock does not sing.
 */
export function stoneImpact(intensity: number, random: Random = Math.random): Layer[] {
  const s = Math.max(0, Math.min(1, intensity));
  const body = (150 + 90 * (1 - s)) * jitter(random, PITCH_JITTER * 2);
  return ([
    { start: 0, gain: 0.5 + 0.4 * s, zzfx: { frequency: 2600, shape: SHAPE_NOISE, attack: 0, release: 0.018 + 0.02 * s, filter: 900 } },
    { start: 0, gain: 0.45 + 0.4 * s, zzfx: { frequency: body, shape: SHAPE_SINE, attack: 0.001, release: 0.07 + 0.08 * s, slide: -0.35 } },
    { start: 0.002, gain: 0.3 + 0.3 * s, zzfx: { frequency: 700, shape: SHAPE_NOISE, attack: 0.001, release: 0.06 + 0.07 * s, filter: -500 } },
    { start: 0, gain: 0.12 + 0.12 * s, zzfx: { frequency: 940 * jitter(random, PITCH_JITTER * 3), shape: SHAPE_SINE, attack: 0.001, release: 0.05 } },
  ] as Layer[]).map(layer => ({ ...layer, gain: layer.gain * STONE_LEVEL }));
}
