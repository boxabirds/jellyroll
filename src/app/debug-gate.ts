/**
 * The first debug key of a run asks first: using one takes the run off the leaderboard, and a stray key press should not do that
 * unnoticed. Enter goes ahead (and the key is then carried out), Escape drops it. Later debug keys in the same run are not asked about.
 */
export const DEBUG_WARNING = 'About to enter the debug menu: it disqualifies this run from the leaderboard.';

export class DebugGate {
  /** Called when the question opens or closes, so the game can wait and the game's own keys can be held back. */
  onOpen: (open: boolean) => void = () => {};
  private readonly root = document.createElement('section');
  private pending: (() => void) | null = null;

  constructor() {
    this.root.id = 'debug-gate';
    this.root.setAttribute('role', 'alertdialog');
    this.root.setAttribute('aria-label', 'Debug keys');
    this.root.setAttribute('aria-modal', 'true');
    const card = document.createElement('div');
    card.className = 'gate-card';
    const title = document.createElement('h2');
    title.textContent = 'Debug keys';
    const text = document.createElement('p');
    text.textContent = `${DEBUG_WARNING} Continue?`;
    const actions = document.createElement('div');
    actions.className = 'gate-actions';
    const go = document.createElement('button');
    go.type = 'button'; go.className = 'gate-go'; go.innerHTML = 'Continue <kbd>Enter</kbd>';
    const stop = document.createElement('button');
    stop.type = 'button'; stop.className = 'gate-stop'; stop.innerHTML = 'Cancel <kbd>Esc</kbd>';
    go.addEventListener('click', () => this.answer(true));
    stop.addEventListener('click', () => this.answer(false));
    actions.append(go, stop);
    card.append(title, text, actions);
    this.root.append(card);
    document.body.append(this.root);
    window.addEventListener('keydown', this.keydown, true);
  }

  get isOpen(): boolean { return this.pending !== null; }

  /** Ask; `proceed` runs only if the player says to go on. */
  ask(proceed: () => void) {
    if (this.pending) return;
    this.pending = proceed;
    this.root.classList.add('shown');
    this.onOpen(true);
    this.root.querySelector<HTMLButtonElement>('.gate-go')!.focus();
  }

  /** A new run: any question still open is dropped. */
  close() {
    if (this.pending) this.answer(false);
  }

  private answer(go: boolean) {
    const proceed = this.pending;
    this.pending = null;
    this.root.classList.remove('shown');
    (document.activeElement as HTMLElement | null)?.blur();
    this.onOpen(false);
    if (go && proceed) proceed();
  }

  private readonly keydown = (event: KeyboardEvent) => {
    if (!this.pending) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat) return;
    if (event.key === 'Enter') this.answer(true);
    else if (event.key === 'Escape') this.answer(false);
  };

  dispose() {
    window.removeEventListener('keydown', this.keydown, true);
    this.root.remove();
  }
}
