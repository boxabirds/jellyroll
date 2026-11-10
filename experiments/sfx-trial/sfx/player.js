/**
 * Plays rendered samples. Deliberately the plainest Web Audio there is: one
 * AudioBufferSourceNode per sound into a gain node. No AudioWorklet, no WASM,
 * nothing to fetch, so there is nothing that can fail to load.
 */

const MASTER_GAIN = 0.9;
const ANALYSER_SIZE = 2048;
const MONO = 1;

export class SfxPlayer {
  /** @type {AudioContext | null} */
  context = null;
  /** @type {GainNode | null} */
  master = null;
  /** @type {AnalyserNode | null} */
  analyser = null;
  /** Sounds started so far. */
  played = 0;
  #meterSamples = new Float32Array(ANALYSER_SIZE);

  /**
   * Call first thing inside every user-gesture handler (click, keydown,
   * touchend). The first call creates the context inside the gesture, which is
   * what Safari requires; later calls revive a context the browser suspended
   * or interrupted (tab switch, phone call, screen lock).
   * @returns {AudioContext}
   */
  unlock() {
    if (!this.context) {
      const AudioContextClass = globalThis.AudioContext ?? /** @type {any} */ (globalThis).webkitAudioContext;
      const context = /** @type {AudioContext} */ (new AudioContextClass({ latencyHint: 'interactive' }));
      this.context = context;
      this.master = context.createGain();
      this.master.gain.value = MASTER_GAIN;
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = ANALYSER_SIZE;
      this.master.connect(this.analyser).connect(context.destination);
    }
    if (this.context.state !== 'running') void this.context.resume();
    return this.context;
  }

  /** The rate to render at so the browser does not resample. */
  get sampleRate() {
    return this.unlock().sampleRate;
  }

  /**
   * @param {Float32Array} samples mono, rendered at this.sampleRate
   * @param {number} delay seconds from now
   */
  play(samples, delay = 0) {
    const context = this.unlock();
    const buffer = context.createBuffer(MONO, samples.length, context.sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(/** @type {GainNode} */ (this.master));
    source.start(context.currentTime + delay);
    this.played++;
  }

  /** Peak of what is leaving the master gain right now, 0..1: evidence that sound is being made. */
  outputPeak() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.#meterSamples);
    let peak = 0;
    for (const sample of this.#meterSamples) peak = Math.max(peak, Math.abs(sample));
    return peak;
  }
}
