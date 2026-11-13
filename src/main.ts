/**
 * Browser shell: static interface, loading card and the one visible failure
 * path. Boot pattern follows Jelly Baby's src/main.ts (GPL-3.0-only; see
 * NOTICE.md): the whole startup is a single observed promise chain.
 */
import './style.css';
import { BUILD_TIME, versionLabel } from './shared/version.ts';
import { INTERRUPTED_COPY, INTERRUPTED_EVENT, InterruptedError, UnsupportedError, describeUnsupported } from './render/unsupported.ts';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main id="viewport" aria-label="Jellyland"></main>
  <aside class="readout" aria-label="Run statistics">
    <div class="stat primary"><span id="distance">0 m</span><label>score</label></div>
    <div class="stat"><span><b id="speed">0</b> km/h</span><label>speed</label></div>
    <div class="stat optional"><span id="air">0.0 s</span><label>air time</label></div>
    <div class="stat"><span id="size">– cm</span><label>jelly</label></div>
    <div class="stat optional"><span id="merges">0</span><label>merged</label></div>
    <div class="stat optional"><span id="snow">0%</span><label>snow</label></div>
    <div class="stat optional"><span id="best">0 m</span><label>best</label></div>
  </aside>
  <div id="biome-banner" class="biome-banner" role="status" aria-live="polite"><b id="biome-banner-name"></b><span id="biome-banner-wear"></span></div>
  <div id="alarm" class="alarm" aria-hidden="true"></div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <div id="warning" class="warning" role="alert"></div>
  <div id="magnet" class="power-up" role="status" aria-live="polite"><span class="power-up-icon" aria-hidden="true"></span>magnet <b id="magnet-seconds">0.0 s</b></div>
  <footer id="hints" class="hints" aria-label="Keyboard controls">
    <span><kbd>W</kbd> faster</span><span><kbd>S</kbd> slower</span>
    <span><kbd>A</kbd> left</span><span><kbd>D</kbd> right</span>
    <span><kbd class="wide">space</kbd> jump</span>
    <span class="separator"></span><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> use power-up</span><span><kbd>R</kbd> restart</span><span><kbd>M</kbd> mute</span><span><kbd>?</kbd> hide</span>
  </footer>
  <div id="powerups" class="powerups" aria-label="Power-ups you are carrying">
    <button class="slot" data-slot="0" type="button" title="Magnet (1)" aria-label="Magnet"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h6v10a2 2 0 0 0 4 0V3h6v10a8 8 0 0 1-16 0z" fill="#e8323c"/><rect x="4" y="3" width="6" height="5" fill="#f4f4f4"/><rect x="14" y="3" width="6" height="5" fill="#f4f4f4"/></svg><b>0</b><kbd>1</kbd></button>
    <button class="slot" data-slot="1" type="button" title="Glass marble (2)" aria-label="Glass marble"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#cfeaff" stroke="#8fb8d8" stroke-width="1.5"/><path d="M5 11c3-5 11-5 14 0" fill="none" stroke="#ff4d6d" stroke-width="2.2"/><path d="M6 15c4 4 9 3 12-1" fill="none" stroke="#3a8bff" stroke-width="2.2"/><circle cx="8.5" cy="8" r="2" fill="#fff" opacity=".8"/></svg><b>0</b><kbd>2</kbd></button>
    <button class="slot" data-slot="2" type="button" title="Seeds (3)" aria-label="Seeds"><svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="8.500" cy="13" rx="5" ry="8" transform="rotate(-22 8.500 13)" fill="#8a5a2b"/><path d="M6 8c-1.500 3-1.500 7 .5 10" fill="none" stroke="#d9ad70" stroke-width="1.600" stroke-linecap="round"/><ellipse cx="16" cy="11" rx="4.600" ry="7.500" transform="rotate(24 16 11)" fill="#62c934"/><path d="M17.500 6.500c1.500 3 1.500 6.500-.5 9" fill="none" stroke="#c4f59a" stroke-width="1.500" stroke-linecap="round"/></svg><b>0</b><kbd>3</kbd></button>
    <button class="slot" data-slot="3" type="button" title="Freeze ray (4)" aria-label="Freeze ray"><svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="#7fd0ff" stroke-width="2.4" stroke-linecap="round" fill="none"><path d="M12 2v20M3.300 7l17.400 10M3.300 17L20.700 7"/><path d="M9 4l3 2.500L15 4M9 20l3-2.500 3 2.500" stroke-width="1.800"/></g><circle cx="12" cy="12" r="2.800" fill="#e8f7ff" stroke="#7fd0ff" stroke-width="1.400"/></svg><b>0</b><kbd>4</kbd></button>
  </div>
  <button id="scores-button" class="scores-button" type="button" aria-label="Top rolls">Top rolls <kbd>T</kbd></button>
  <section id="worn-out" role="status" aria-live="polite"><div class="worn-card"><h2>Worn away.</h2><p>Score <b id="final-distance">0 m</b> · air time <b id="final-air">0.0 s</b></p><p>Merge with more mushrooms to roll further.</p><p id="score-note" class="score-note"></p><p class="keys-only"><kbd class="wide">space</kbd> or <kbd>R</kbd> to roll again</p><p class="touch-only">Tap the jump button to roll again</p></div></section>
  <section id="loading" role="status" aria-live="polite"><div class="loading-card"><div class="jelly-mark"></div><h2>Nearly rolling.</h2><p id="load-message">Loading the game</p><p id="load-hint" class="load-hint" hidden></p><pre id="fatal" hidden></pre><button id="retry" hidden>Try again</button></div></section>
`;

/** Lost while the page was in the background: start over by itself when it comes back (once a minute at most, so it cannot loop). */
const RESTART_KEY = 'jellyland.restarted-at';
const RESTART_GAP_MS = 60_000;
function startAgainWhenBack() {
  if (!document.hidden) return;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    try {
      const last = Number(sessionStorage.getItem(RESTART_KEY) ?? 0);
      if (Date.now() - last < RESTART_GAP_MS) return;
      sessionStorage.setItem(RESTART_KEY, String(Date.now()));
    } catch { /* private mode: no limit to keep */ }
    location.reload();
  }, { once: true });
}

console.info(`[Jellyland] ${versionLabel()} · built ${BUILD_TIME}`);

let stage = 'Loading the game', failed = false, game: { stop: () => void } | undefined;
function fail(reason: unknown) {
  if (failed) return; failed = true;
  const error = reason instanceof Error ? reason : new Error(String(reason));
  // The game saves the run it was in before it stops, so Try again can carry on from here.
  if (error instanceof InterruptedError) window.dispatchEvent(new Event(INTERRUPTED_EVENT));
  game?.stop();
  document.querySelector('#loading')!.classList.remove('hidden');
  document.querySelector('#loading')!.classList.add('failed');
  if (error instanceof UnsupportedError) {
    // Not a bug: this device cannot run the game. Say so plainly, and keep the technical line for those who want it.
    const copy = describeUnsupported(error.kind);
    document.querySelector('#loading')!.classList.add('unsupported');
    document.querySelector('#loading h2')!.textContent = copy.title;
    document.querySelector('#load-message')!.textContent = copy.message;
    const hint = document.querySelector<HTMLParagraphElement>('#load-hint')!; hint.hidden = false; hint.textContent = copy.hint;
    document.querySelector<HTMLButtonElement>('#retry')!.hidden = false;
    console.warn(`[Jellyland] ${error.message}`);
    return;
  }
  const interrupted = error instanceof InterruptedError;
  if (interrupted) startAgainWhenBack();
  document.querySelector('#loading h2')!.textContent = interrupted ? INTERRUPTED_COPY.title : 'A little hiccup.';
  document.querySelector('#load-message')!.textContent = interrupted ? INTERRUPTED_COPY.message : 'The game couldn’t start. Details below.';
  if (interrupted) { const hint = document.querySelector<HTMLParagraphElement>('#load-hint')!; hint.hidden = false; hint.textContent = INTERRUPTED_COPY.hint; }
  const fatal = document.querySelector<HTMLPreElement>('#fatal')!; fatal.hidden = false;
  fatal.textContent = `${stage}\n${error.message}\n\n${versionLabel()}\nViewport: ${innerWidth} × ${innerHeight} · DPR ${devicePixelRatio}\n${navigator.userAgent}`;
  document.querySelector<HTMLButtonElement>('#retry')!.hidden = false;
  console.error(`[Jellyland / ${stage}]`, error);
}
window.addEventListener('error', event => fail(event.error || event.message));
window.addEventListener('unhandledrejection', event => fail(event.reason));
document.querySelector('#retry')!.addEventListener('click', () => location.reload());

// One observed chain covers imports, initialization, compilation, warmup and first render.
void import('./app/runtime.ts').then(({ startGame }) => startGame(message => {
  if (failed) throw new Error('Startup aborted after a GPU failure');
  stage = message; document.querySelector('#load-message')!.textContent = message;
}, fail)).then(started => {
  game = started;
  if (failed) { game.stop(); return; }
  stage = 'Playing'; document.querySelector('#loading')!.classList.add('hidden');
}).catch(fail);
