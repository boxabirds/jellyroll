/**
 * A tiny floating label for each merge saying how much the jelly grew:
 * "+6 cm", in the colour of what was eaten, rising and fading above the jelly.
 * A fixed pool of page elements is reused; nothing is created while playing.
 */
import * as THREE from 'three/webgpu';
import { growthCentimetres, MIN_VISIBLE_GROWTH_CM } from '../game/growth.ts';
import type { Pickup } from '../game/physics.ts';
import { sweetColor } from '../render/colors.ts';

const POOL = 16;
/** The label starts this far above the top of the jelly (fraction of its radius). */
const ABOVE_TOP = 0.25;
/** Labels from merges in quick succession are fanned out sideways by this many pixels each. */
const FAN_PX = 34;
/** A fresh label is offset to the right of an older one if it appears within this window. */
const FAN_WINDOW_MS = 260;
const MAX_FAN = 4;
const MAX_SIZE_LABEL = 'max size';
const LOSS_TINT = '#e11d1d';

export class GrowthPopups {
  private readonly elements: HTMLElement[] = [];
  private readonly top = new THREE.Vector3();
  private next = 0;
  private lastSpawn = Number.NEGATIVE_INFINITY;
  private fan = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    const layer = document.createElement('div');
    layer.className = 'growth-layer';
    layer.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < POOL; i++) {
      const element = document.createElement('span');
      element.className = 'growth-popup';
      element.addEventListener('animationend', () => element.classList.remove('playing'));
      layer.append(element);
      this.elements.push(element);
    }
    document.body.append(layer);
    this.layer = layer;
  }

  private readonly layer: HTMLElement;

  /**
   * @param center the jelly's centre in render space, and its current radius
   * @param now    a clock in milliseconds
   */
  spawn(pickup: Pickup, center: THREE.Vector3, jellyRadius: number, now: number) {
    const cm = growthCentimetres(pickup.jellyRadius, pickup.volume);
    this.place(cm >= MIN_VISIBLE_GROWTH_CM ? `+${Math.max(1, Math.round(cm))} cm` : MAX_SIZE_LABEL, sweetColor(pickup.kind, pickup.color).deep.getStyle(), false, center, jellyRadius, now);
  }

  private place(text: string, tint: string, loss: boolean, center: THREE.Vector3, jellyRadius: number, now: number) {
    const element = this.elements[this.next];
    this.next = (this.next + 1) % POOL;
    element.textContent = text;
    element.classList.toggle('loss', loss);
    element.style.setProperty('--tint', tint);
    // Where the top of the jelly is on screen.
    this.top.set(center.x, center.y + jellyRadius * (1 + ABOVE_TOP), center.z).project(this.camera);
    this.fan = now - this.lastSpawn < FAN_WINDOW_MS ? Math.min(this.fan + 1, MAX_FAN) : 0;
    this.lastSpawn = now;
    const x = (this.top.x * 0.5 + 0.5) * window.innerWidth + (this.fan % 2 === 0 ? 1 : -1) * Math.ceil(this.fan / 2) * FAN_PX;
    const y = (-this.top.y * 0.5 + 0.5) * window.innerHeight;
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    // Restart the animation even if this element is still playing an old one.
    element.classList.remove('playing');
    void element.offsetWidth;
    element.classList.add('playing');
  }

  /** A red "-N cm" that drops away from the top of the jelly, for what wear and melting took. */
  spawnLoss(centimetres: number, center: THREE.Vector3, jellyRadius: number, now: number) {
    this.place(`\u2212${centimetres} cm`, LOSS_TINT, true, center, jellyRadius, now);
  }

  clear() {
    for (const element of this.elements) element.classList.remove('playing');
  }

  dispose() {
    this.layer.remove();
  }
}

