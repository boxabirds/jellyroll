/**
 * Turns the layers from sfx-sounds.ts into one buffer of samples. Pure
 * JavaScript, no Web Audio, so the same code runs in the game and in the tests.
 */
import type { Layer } from './sfx-sounds.ts';
import { ZZFX_PARAMETER_ORDER, zzfxBuildSamples } from './zzfx/zzfx-synth.js';

/** Layers already carry their own variation, so ZzFX's built-in pitch randomness is off. */
const ZZFX_RANDOMNESS_OFF = 0;
const noRandom = () => 0;

/** A layer's sound as the positional array ZzFX and its sound designer use. */
export function toZzfxArray(layer: Layer): (number | undefined)[] {
  return ZZFX_PARAMETER_ORDER.map(name => {
    if (name === 'randomness') return ZZFX_RANDOMNESS_OFF;
    if (name === 'volume') return layer.gain;
    return layer.zzfx[name];
  });
}

/**
 * @param sampleRate render at the AudioContext's own rate so nothing is resampled
 * @returns mono samples, the layers summed
 */
export function renderLayers(layers: Layer[], sampleRate: number): Float32Array {
  const parts = layers.map(layer => ({
    offset: Math.round(layer.start * sampleRate),
    samples: zzfxBuildSamples(sampleRate, noRandom, toZzfxArray(layer)),
  }));
  const length = parts.reduce((longest, part) => Math.max(longest, part.offset + part.samples.length), 0);
  const mix = new Float32Array(length);
  for (const { offset, samples } of parts) {
    for (let i = 0; i < samples.length; i++) mix[offset + i] += samples[i];
  }
  return mix;
}
