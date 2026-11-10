/**
 * Browser shell: static interface, loading card and the one visible failure
 * path. Boot pattern follows Jelly Baby's src/main.ts (GPL-3.0-only; see
 * NOTICE.md): the whole startup is a single observed promise chain.
 */
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main id="viewport" aria-label="Jellyland"></main>
  <header class="masthead"><span class="eyebrow">an endless downhill</span><h1>jellyland<span>.</span></h1></header>
  <aside class="readout" aria-label="Run statistics">
    <div class="stat primary"><span id="distance">0 m</span><label>score</label></div>
    <div class="stat"><span><b id="speed">0</b> km/h</span><label>speed</label></div>
    <div class="stat"><span id="air">0.0 s</span><label>air time</label></div>
    <div class="stat"><span id="size">120 cm</span><label>jelly</label></div>
    <div class="stat"><span id="merges">0</span><label>merged</label></div>
    <div class="stat"><span id="best">0 m</span><label>best</label></div>
  </aside>
  <footer id="hints" class="hints" aria-label="Keyboard controls">
    <span><kbd>W</kbd> faster</span><span><kbd>S</kbd> slower</span>
    <span><kbd>A</kbd> left</span><span><kbd>D</kbd> right</span>
    <span><kbd class="wide">space</kbd> jump</span>
    <span class="separator"></span><span><kbd>R</kbd> restart</span><span><kbd>M</kbd> mute</span><span><kbd>?</kbd> hide</span>
  </footer>
  <section id="worn-out" role="status" aria-live="polite"><div class="worn-card"><h2>Worn away.</h2><p>Score <b id="final-distance">0 m</b> · air time <b id="final-air">0.0 s</b></p><p>Merge with more mushrooms to roll further.</p><p><kbd class="wide">space</kbd> or <kbd>R</kbd> to roll again</p></div></section>
  <section id="loading" role="status" aria-live="polite"><div class="loading-card"><div class="jelly-mark"></div><h2>Nearly rolling.</h2><p id="load-message">Loading the game</p><pre id="fatal" hidden></pre><button id="retry" hidden>Try again</button></div></section>
`;

let stage = 'Loading the game', failed = false, game: { stop: () => void } | undefined;
function fail(reason: unknown) {
  if (failed) return; failed = true; game?.stop();
  const error = reason instanceof Error ? reason : new Error(String(reason));
  document.querySelector('#loading')!.classList.remove('hidden');
  document.querySelector('#loading')!.classList.add('failed');
  document.querySelector('#loading h2')!.textContent = 'A little hiccup.';
  document.querySelector('#load-message')!.textContent = 'The game couldn’t start. Details below.';
  const fatal = document.querySelector<HTMLPreElement>('#fatal')!; fatal.hidden = false;
  fatal.textContent = `${stage}\n${error.message}\n\nViewport: ${innerWidth} × ${innerHeight} · DPR ${devicePixelRatio}\n${navigator.userAgent}`;
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
