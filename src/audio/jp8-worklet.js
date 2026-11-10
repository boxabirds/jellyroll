/**
 * AudioWorklet host for the JP-8 synth engine (Apache-2.0; the compiled engine
 * is vendored at src/audio/jp8/jp8_wasm_bg.wasm). The game uses it for the
 * background drone.
 *
 * This file is loaded as a worklet module, so it is plain JavaScript with no
 * imports. The WASM module is compiled on the main thread and handed over in
 * processorOptions; the one import the module needs is provided here, so the
 * wasm-bindgen glue (which wants TextDecoder and fetch) is not required.
 *
 * Render path rules: process() allocates nothing. Its views into WASM memory
 * are created once at init, and the engine's buffers are static, so memory
 * does not grow while rendering.
 */
const BLOCK_FRAMES = 128;
const CHANNELS = 2;
const PARAM_COUNT = 68;
const ENGINE_ID = 0;
const WASM_IMPORT_MODULE = './jp8_wasm_bg.js';
/** Slots wasm-bindgen reserves in its externref table for undefined/null/true/false. */
const EXTERNREF_RESERVED = 4;

class Jp8Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.engine = null;
    this.output = null;
    this.params = null;
    this.port.onmessage = event => this.handle(event.data);
    try {
      this.init(options.processorOptions.wasmModule);
      this.port.postMessage({ type: 'ready' });
    } catch (error) {
      this.port.postMessage({ type: 'error', message: String(error) });
    }
  }

  init(wasmModule) {
    let exports = null;
    const instance = new WebAssembly.Instance(wasmModule, {
      [WASM_IMPORT_MODULE]: {
        __wbindgen_init_externref_table() {
          const table = exports.__wbindgen_externrefs;
          const offset = table.grow(EXTERNREF_RESERVED);
          table.set(0, undefined);
          table.set(offset, undefined);
          table.set(offset + 1, null);
          table.set(offset + 2, true);
          table.set(offset + 3, false);
        },
      },
    });
    exports = instance.exports;
    exports.__wbindgen_start();
    exports.create_engine(ENGINE_ID, sampleRate);
    this.output = new Float32Array(exports.memory.buffer, exports.get_output_ptr(ENGINE_ID), exports.get_output_len());
    this.params = new Float32Array(exports.memory.buffer, exports.get_param_ptr(ENGINE_ID), PARAM_COUNT);
    this.engine = exports;
  }

  /** Runs between render quanta, never inside process(). */
  handle(message) {
    const engine = this.engine;
    if (!engine) return;
    switch (message.type) {
      case 'patch':
        this.params.set(message.params);
        engine.apply_params_from_buf(ENGINE_ID);
        break;
      case 'param':
        this.params[message.index] = message.value;
        engine.apply_params_from_buf(ENGINE_ID);
        break;
      case 'note-on':
        engine.note_on(ENGINE_ID, message.note, message.velocity);
        break;
      case 'note-off':
        engine.note_off(ENGINE_ID, message.note);
        break;
      case 'all-notes-off':
        engine.all_notes_off(ENGINE_ID);
        break;
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const engine = this.engine;
    if (!engine || out.length < CHANNELS) return true;
    engine.render(ENGINE_ID);
    const left = out[0];
    const right = out[1];
    const buffer = this.output;
    for (let i = 0; i < BLOCK_FRAMES; i++) {
      left[i] = buffer[i * CHANNELS];
      right[i] = buffer[i * CHANNELS + 1];
    }
    return true;
  }
}

registerProcessor('jellyland-jp8', Jp8Processor);
