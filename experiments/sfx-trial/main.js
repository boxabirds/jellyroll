/** Page wiring only: buttons, read-outs. The sounds live in sfx/. */
import { EFFECTS } from './sfx/catalogue.js';
import { SfxPlayer } from './sfx/player.js';
import { renderLayers } from './sfx/render.js';

const PERCENT = 100;
const LEVEL_DECIMALS = 3;

const player = new SfxPlayer();
let loudest = 0;

const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

function trigger(/** @type {typeof EFFECTS[number]} */ effect) {
  try {
    // Inside the click handler: the context is created and resumed here, in the gesture.
    player.unlock();
    player.play(renderLayers(effect.layers(Math.random), player.sampleRate));
    byId('error').textContent = 'none';
  } catch (error) {
    byId('error').textContent = String(error);
    byId('error').className = 'silent';
  }
}

for (const effect of EFFECTS) {
  const button = document.createElement('button');
  button.textContent = effect.label;
  button.dataset.effect = effect.id;
  button.addEventListener('click', () => trigger(effect));
  byId('effects').append(button);
}

function refresh() {
  const peak = player.outputPeak();
  loudest = Math.max(loudest, peak);
  const state = player.context?.state ?? 'not created yet (press a button)';
  byId('context-state').textContent = state;
  byId('context-state').className = player.context && state !== 'running' ? 'silent' : '';
  byId('sample-rate').textContent = player.context ? `${player.context.sampleRate} Hz` : '-';
  byId('played').textContent = String(player.played);
  byId('loudest').textContent = loudest.toFixed(LEVEL_DECIMALS);
  byId('meter-fill').style.width = `${Math.min(1, peak) * PERCENT}%`;
  requestAnimationFrame(refresh);
}
refresh();

/** For the automated check in scripts/browser_check.py. */
Object.assign(globalThis, {
  sfxTrial: {
    state: () => ({ context: player.context?.state ?? 'none', played: player.played, loudest, sampleRate: player.context?.sampleRate ?? 0 }),
    outputPeak: () => player.outputPeak(),
  },
});
