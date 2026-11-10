/**
 * Turns the layers from jelly-sounds.js into one buffer of samples. Pure
 * JavaScript, no Web Audio, so the same code runs in the page and in Node.
 */
import { ZZFX_PARAMETER_ORDER, zzfxBuildSamples } from '../vendor/zzfx-synth.js';

/** @typedef {import('./jelly-sounds.js').Layer} Layer */

/** Layers already carry their own variation, so ZzFX's built-in pitch randomness is off. */
const ZZFX_RANDOMNESS_OFF = 0;
const noRandom = () => 0;

/**
 * A layer's sound as the positional array ZzFX and its sound designer use:
 * paste it into `zzfx(...[ ])` at https://killedbyapixel.github.io/ZzFX/.
 * @param {Layer} layer
 * @returns {(number | undefined)[]}
 */
export function toZzfxArray(layer) {
  return ZZFX_PARAMETER_ORDER.map(name => {
    if (name === 'randomness') return ZZFX_RANDOMNESS_OFF;
    if (name === 'volume') return layer.gain;
    return layer.zzfx[name];
  });
}

/**
 * @param {Layer[]} layers
 * @param {number} sampleRate render at the AudioContext's own rate so nothing is resampled
 * @returns {Float32Array} mono samples, the layers summed
 */
export function renderLayers(layers, sampleRate) {
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
