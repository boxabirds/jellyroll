/** Types for the vendored ZzFX sample generator (zzfx-synth.js). */
export const ZZFX_PARAMETER_ORDER: readonly string[];
export const ZZFX_DEFAULT_SAMPLE_RATE: number;
export function zzfxBuildSamples(sampleRate: number, random: () => number, parameters: (number | undefined)[]): Float32Array;
