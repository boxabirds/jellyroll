/**
 * The row of badges at the top of the screen: one shield per biome, showing the
 * collectible of that biome and the level the shield has reached (0 0 0 0 0 at
 * the start), with a thin bar for how far the next level is; and, once there is
 * a bee, a bee badge with how many there are and what each one carries.
 */
import { BIOMES, BIOME_ORDER } from '../game/biomes.ts';
import type { Ball } from '../game/physics.ts';
import { beeCapacity, beeLevel, SHIELD_MAX_LEVEL, BEE_MAX_LEVEL, stepProgress } from '../game/progression.ts';
import { BEE_MAX, BEE_STEPS, SHIELD_REDUCTION, SHIELD_STEPS } from '../game/tuning.ts';

const PERCENT = 100;
/** A shield flashes for this long when it levels up. */
const LEVEL_UP_MS = 1400;

const NS = 'http://www.w3.org/2000/svg';
/** The shield outline, in a 40 x 46 box. */
const SHIELD_PATH = 'M20 2 L37 8 V22 C37 33 29 41 20 44 C11 41 3 33 3 22 V8 Z';

/** The blob of each biome, drawn in a 24 x 24 box in the colour given. Index = the biome's own index. */
const ICONS: readonly string[] = [
  // Meadow: a jelly mushroom (dome with a stem and a spot).
  '<path d="M3 13 C3 6 8 3 12 3 C16 3 21 6 21 13 Z" fill="#ff4d6d"/><rect x="9" y="12.5" width="6" height="8" rx="3" fill="#fff4d6"/><circle cx="9" cy="8.5" r="1.7" fill="#fff"/><circle cx="14.5" cy="7.5" r="1.3" fill="#fff"/>',
  // Ice: a snowball.
  '<circle cx="12" cy="12.5" r="8.5" fill="#f4fbff" stroke="#9fc4e8" stroke-width="1.2"/><circle cx="9" cy="9.5" r="2.4" fill="#fff"/>',
  // Dunes: a cactus.
  '<rect x="9.5" y="3" width="5" height="18" rx="2.5" fill="#3fae4c"/><path d="M9.5 13 H6.5 V8.5" fill="none" stroke="#3fae4c" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.5 15 H17.5 V10" fill="none" stroke="#3fae4c" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>',
  // Scree: a nugget of gold ore.
  '<path d="M6 15 L8.5 7.5 L14 5 L18.5 9 L19 16 L13.5 19.5 Z" fill="#ffc93a"/><path d="M8.5 7.5 L14 5 L13 12 Z" fill="#fff2b0"/><path d="M13 12 L19 16 L13.5 19.5 Z" fill="#d99a00"/>',
  // Lava: an ember (flame).
  '<path d="M12 2.5 C14 7 19 9 19 14.5 C19 18.5 16 21.5 12 21.5 C8 21.5 5 18.5 5 14.5 C5 11.5 7 10 8 8 C9.5 10 10 10.5 11 10.5 C11 7.5 11 5 12 2.5 Z" fill="#ff6a00"/><path d="M12 11 C13.5 13.5 15.5 14.5 15.5 17 C15.5 19 14 20.2 12 20.2 C10 20.2 8.5 19 8.5 17 C8.5 15.2 10.5 14 12 11 Z" fill="#ffd23a"/>',
  // Cave: a crystal.
  '<path d="M12 2.5 L19 8 L16.5 20.5 H7.5 L5 8 Z" fill="#b06cff"/><path d="M12 2.5 L16.5 20.5 H7.5 Z" fill="#d6b0ff" opacity=".55"/><path d="M5 8 H19" stroke="#fff" stroke-opacity=".5" stroke-width=".8"/>',
];
const BEE_ICON =
  '<ellipse cx="12" cy="14" rx="7" ry="5.2" fill="#ffc61a"/><path d="M9 9.5 V18.5 M13 9 V19 M17 10.2 V17.8" stroke="#2b2118" stroke-width="2.1"/><circle cx="5.2" cy="14" r="3" fill="#2b2118"/><ellipse cx="10" cy="7.2" rx="3.6" ry="2.2" fill="#dff2ff" opacity=".85" transform="rotate(-18 10 7.2)"/><ellipse cx="15" cy="7.2" rx="3.4" ry="2.1" fill="#dff2ff" opacity=".85" transform="rotate(16 15 7.2)"/>';

/** A shield badge's picture: the shield in the biome's colour with its collectible on it. */
function shieldSvg(kind: number): string {
  return `<svg viewBox="0 0 40 46" aria-hidden="true"><path class="shield-body" d="${SHIELD_PATH}"/><g transform="translate(8 7)">${ICONS[kind]}</g></svg>`;
}

type Shield = { root: HTMLElement; level: HTMLElement; fill: HTMLElement; shownLevel: number; flashUntil: number };

export class Badges {
  private readonly root = document.createElement('div');
  private readonly shields: Shield[] = [];
  private readonly bee = document.createElement('div');
  private readonly beeCount = document.createElement('b');
  private readonly beeLevel = document.createElement('span');
  private readonly beeFill = document.createElement('i');
  private readonly glass = document.createElement('div');
  private readonly glassSeconds = document.createElement('b');

  constructor() {
    this.root.className = 'badges';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Shields: each biome’s collectibles level up its shield');
    for (const kind of BIOME_ORDER) this.shields[kind] = this.createShield(kind);
    for (const kind of BIOME_ORDER) this.root.append(this.shields[kind].root);
    this.bee.className = 'bee-badge';
    this.bee.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${BEE_ICON}</svg>`;
    this.beeLevel.className = 'bee-level';
    const bar = document.createElement('span');
    bar.className = 'badge-bar';
    bar.append(this.beeFill);
    this.bee.append(this.beeCount, this.beeLevel, bar);
    this.root.append(this.bee);
    this.glass.className = 'glass-badge';
    this.glass.innerHTML = '<span class="glass-dot" aria-hidden="true"></span>glass';
    this.glass.append(this.glassSeconds);
    this.root.append(this.glass);
    document.body.append(this.root);
  }

  private createShield(kind: number): Shield {
    const root = document.createElement('div');
    root.className = 'shield';
    const reductions = SHIELD_REDUCTION.map(r => `${Math.round(r * PERCENT)}%`).join(', ');
    root.title = `${BIOMES[kind].name} shield: collect ${SHIELD_STEPS.join(', then ')} for levels 1–${SHIELD_MAX_LEVEL} (${reductions} less wear)`;
    root.style.setProperty('--shield', SHIELD_COLORS[kind]);
    root.innerHTML = shieldSvg(kind);
    const level = document.createElement('b');
    level.textContent = '0';
    const bar = document.createElement('span');
    bar.className = 'badge-bar';
    const fill = document.createElement('i');
    bar.append(fill);
    root.append(level, bar);
    return { root, level, fill, shownLevel: 0, flashUntil: 0 };
  }

  update(ball: Ball, now: number) {
    for (const kind of BIOME_ORDER) {
      const shield = this.shields[kind];
      const level = ball.shieldLevels[kind];
      if (level !== shield.shownLevel) {
        shield.level.textContent = String(level);
        if (level > shield.shownLevel) shield.flashUntil = now + LEVEL_UP_MS;
        shield.shownLevel = level;
      }
      const { into, cost } = stepProgress(ball.shieldCounts[kind], SHIELD_STEPS);
      shield.fill.style.width = `${cost > 0 ? (into / cost) * PERCENT : PERCENT}%`;
      shield.root.classList.toggle('empty', level === 0);
      shield.root.classList.toggle('max', level >= SHIELD_MAX_LEVEL);
      shield.root.classList.toggle('flash', now < shield.flashUntil);
    }
    this.glass.classList.toggle('shown', ball.glassSeconds > 0);
    if (ball.glassSeconds > 0) this.glassSeconds.textContent = `${ball.glassSeconds.toFixed(1)} s`;
    const flock = ball.flock;
    this.bee.classList.toggle('shown', flock.count > 0);
    if (flock.count > 0) {
      const level = beeLevel(flock.delivered);
      this.beeCount.textContent = `×${flock.count}${flock.count >= BEE_MAX ? ' max' : ''}`;
      this.beeLevel.textContent = `carries ${beeCapacity(flock.delivered)}`;
      const { into, cost } = stepProgress(flock.delivered, BEE_STEPS);
      this.beeFill.style.width = `${cost > 0 ? (into / cost) * PERCENT : PERCENT}%`;
      this.bee.classList.toggle('max', level >= BEE_MAX_LEVEL);
      this.bee.title = `Bees fetch collectibles for you. ${flock.delivered} brought in; ${BEE_STEPS.join(', then ')} more raise what they carry`;
    }
  }

  dispose() {
    this.root.remove();
  }
}

/** Shield colour per biome index (Meadow, Ice, Dunes, Scree, Lava). */
const SHIELD_COLORS: readonly string[] = ['#5cc43a', '#8cc8ff', '#e0b24a', '#a56bff', '#ff5a1f', '#3d4a6b'];
