/**
 * The first screen: the name of the game in giant jelly letters (the same squishy letters as the name entry), who it is built on and
 * where its source is, and a Play button. The game waits behind it.
 */
import type * as THREE from 'three/webgpu';
import type { LetterStage } from '../world/jelly-letters/letter-stage.ts';
import { versionLabel } from '../shared/version.ts';
import { GAME_REPO_URL, JELLY_TECH_AUTHOR, JELLY_TECH_URL, SPLASH_TITLE } from './splash-links.ts';

/** Time between one letter dropping and the next (milliseconds). */
const LETTER_GAP_MS = 140;
/** The GitHub mark (an Octicon: MIT). */
const GITHUB_MARK = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z';

function link(href: string, ...content: (string | Node)[]): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.append(...content);
  return a;
}

function githubIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'sp-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', GITHUB_MARK); path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

export class Splash {
  private readonly root = document.createElement('section');
  private readonly play = document.createElement('button');
  private timers: number[] = [];
  private readonly resume = document.createElement('button');
  private done: ((choice: 'play' | 'continue') => void) | null = null;

  constructor(private readonly letters: LetterStage, private readonly camera: THREE.PerspectiveCamera) {
    this.root.id = 'splash';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Jelly Roll');
    const title = document.createElement('h1');
    title.className = 'sp-title';
    title.textContent = 'Jelly Roll';
    const tagline = document.createElement('p');
    tagline.className = 'sp-tagline';
    tagline.textContent = 'An endless downhill for one small jelly.';
    const top = document.createElement('div');
    top.className = 'sp-top';
    top.append(title, tagline);
    const credits = document.createElement('div');
    credits.className = 'sp-credits';
    const source = document.createElement('p');
    source.append('Open Source ', link(GAME_REPO_URL, githubIcon(), Object.assign(document.createElement('span'), { textContent: 'boxabirds/jellyroll' })));
    const tech = document.createElement('p');
    tech.append('Jelly tech by ', link(JELLY_TECH_URL, `${JELLY_TECH_AUTHOR}'s Jelly Baby`));
    credits.append(source, tech);
    this.play.type = 'button'; this.play.className = 'sp-play';
    this.play.innerHTML = 'Play <kbd>Enter</kbd>';
    this.resume.type = 'button'; this.resume.className = 'sp-resume'; this.resume.hidden = true;
    const bottom = document.createElement('div');
    bottom.className = 'sp-bottom';
    const version = document.createElement('p');
    version.className = 'sp-version'; version.textContent = versionLabel();
    bottom.append(credits, this.resume, this.play, version);
    this.root.append(top, bottom);
    document.body.append(this.root);
    this.play.addEventListener('click', () => this.finish('play'));
    this.resume.addEventListener('click', () => this.finish('continue'));
  }

  get isOpen(): boolean { return this.root.classList.contains('shown'); }

  /** A run that was interrupted can be picked up again: add a button for it above Play (and make it the one Enter chooses). */
  offerResume(metres: string) {
    this.resume.hidden = false;
    this.resume.innerHTML = `Continue your roll <b>${metres}</b>`;
    this.play.textContent = 'New roll';
    this.resume.focus({ preventScroll: true });
  }

  /** Show the screen and let the letters drop; resolves when the player chooses to play (a new roll) or to carry on with the interrupted one. */
  show(): Promise<'play' | 'continue'> {
    this.root.classList.add('shown');
    this.letters.show(this.camera);
    let delay = 0;
    for (const character of SPLASH_TITLE) {
      // (The space is laid at its place in the order: the letters are not there yet to be spaced from.)
      if (character === ' ') { this.timers.push(window.setTimeout(() => this.letters.addSpace(), delay)); continue; }
      this.timers.push(window.setTimeout(() => this.letters.add(character), delay));
      delay += LETTER_GAP_MS;
    }
    window.addEventListener('keydown', this.keydown, true);
    this.play.focus({ preventScroll: true });
    return new Promise(resolve => { this.done = resolve; });
  }

  private finish(choice: 'play' | 'continue') {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.length = 0;
    window.removeEventListener('keydown', this.keydown, true);
    this.root.classList.remove('shown');
    this.letters.hide();
    (document.activeElement as HTMLElement | null)?.blur();
    const done = this.done; this.done = null;
    done?.(choice);
  }

  private readonly keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // On a link, Enter follows the link; everywhere else it plays.
    if ((event.target as HTMLElement | null)?.closest('a')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    // Enter takes whichever is the main button: carrying on, when there is a roll to carry on with.
    if (!event.repeat) this.finish(this.resume.hidden ? 'play' : 'continue');
  };

  dispose() {
    for (const timer of this.timers) window.clearTimeout(timer);
    window.removeEventListener('keydown', this.keydown, true);
    this.root.remove();
  }
}
