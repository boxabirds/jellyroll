/** The world table: the best rolls from everyone, with the player's own row picked out. */
import { TABLE_PAGE_SIZE } from '../shared/run-rules.ts';
import { formatDistance } from '../shared/distance.ts';
import { loadTable } from './run-session.ts';
import type { TableRow } from './run-session.ts';

export interface BoardOptions {
  /** The score just accepted, to highlight. */
  mineId?: string;
  /** The player's own distance, shown when the table cannot be loaded. */
  distance?: number;
  /** A line above the table (why a score was not counted, say). */
  note?: string;
}

export class Scoreboard {
  /** Called when the table is closed. */
  onClose: () => void = () => {};
  private readonly root = document.createElement('section');
  private readonly note = document.createElement('p');
  private readonly rows = document.createElement('ol');
  private readonly status = document.createElement('p');
  private readonly close = document.createElement('button');
  private generation = 0;

  constructor() {
    this.root.id = 'scoreboard';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Top rolls');
    const card = document.createElement('div');
    card.className = 'sb-card';
    const title = document.createElement('h2');
    title.textContent = 'Top rolls';
    this.note.className = 'sb-note';
    this.rows.className = 'sb-rows';
    this.status.className = 'sb-status';
    this.close.className = 'sb-close'; this.close.textContent = 'Close';
    card.append(title, this.note, this.rows, this.status, this.close);
    this.root.append(card);
    document.body.append(this.root);
    this.close.addEventListener('click', () => this.hide());
  }

  get isOpen(): boolean { return this.root.classList.contains('shown'); }

  async show(options: BoardOptions = {}) {
    const generation = ++this.generation;
    this.root.classList.add('shown');
    window.addEventListener('keydown', this.keydown, true);
    this.note.textContent = options.note ?? '';
    this.rows.innerHTML = '';
    this.status.textContent = 'Loading…';
    this.close.focus();
    const table = await loadTable(options.mineId);
    if (generation !== this.generation || !this.isOpen) return;
    this.rows.innerHTML = '';
    if (!table) {
      this.status.textContent = options.distance !== undefined
        ? `The table can't be reached right now. Your roll: ${formatDistance(options.distance)}.`
        : "The table can't be reached right now.";
      return;
    }
    if (table.rows.length === 0) { this.status.textContent = options.mineId ? '' : 'Nobody is on the table yet. You could be the first.'; }
    else this.status.textContent = '';
    for (const row of table.rows) this.rows.append(this.item(row));
    if (table.me && !table.rows.some(r => r.mine)) {
      const gap = document.createElement('li'); gap.className = 'sb-gap'; gap.textContent = '…';
      this.rows.append(gap, this.item(table.me));
    }
    if (table.rows.length === TABLE_PAGE_SIZE) this.root.dataset.full = 'true'; else delete this.root.dataset.full;
  }

  hide() {
    if (!this.isOpen) return;
    this.generation++;
    this.root.classList.remove('shown');
    window.removeEventListener('keydown', this.keydown, true);
    this.onClose();
  }

  dispose() { this.hide(); this.root.remove(); }

  private item(row: TableRow): HTMLLIElement {
    const item = document.createElement('li');
    item.className = row.mine ? 'sb-row mine' : 'sb-row';
    const rank = Object.assign(document.createElement('span'), { className: 'sb-rank', textContent: String(row.rank) });
    const name = Object.assign(document.createElement('span'), { className: 'sb-name', textContent: row.name });
    const distance = Object.assign(document.createElement('span'), { className: 'sb-dist', textContent: formatDistance(row.distance) });
    item.append(rank, name, distance);
    return item;
  }

  private readonly keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === 'Tab') {
      if (event.key === 'Tab') return;
      event.preventDefault(); event.stopPropagation(); this.hide();
    }
  };
}
