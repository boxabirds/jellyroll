/**
 * The merges currently being shown. Physics has already merged each mushroom
 * (the jelly is already its new size); this is only the animation, so the
 * renderer can show the squash, blend and fuse. No rendering imports.
 */
import { createMergeShape, createMergeSpec, mergeDuration, mergeShape, setMergeSpec, type MergeShape, type MergeSpec } from './merge-timeline.ts';
import type { Pickup } from './physics.ts';
import { MAX_MERGES } from './tuning.ts';

export type Merge = {
  active: boolean;
  age: number;
  total: number;
  spec: MergeSpec;
  shape: MergeShape;
  kind: number; look: number; color: number; color2: number; seed: number;
  radius: number;
  /** The jelly's radius when it began, and the volume this merge adds to it. */
  jellyRadius: number;
  volume: number;
  /** Unit direction from the jelly's centre to the mushroom, world axes. */
  dirX: number; dirY: number; dirZ: number;
  /** Colour lobe on the jelly that shows this mushroom, or -1. */
  lobe: number;
};

/** A merge that has just finished, for the one frame in which the jelly reacts. */
export type Completion = { lobe: number; radius: number; jellyRadius: number };

function createMerge(): Merge {
  return {
    active: false, age: 0, total: 0, spec: createMergeSpec(), shape: createMergeShape(),
    kind: 0, look: 0, color: 0, color2: 0, seed: 0, radius: 0, jellyRadius: 0, volume: 0, dirX: 0, dirY: 1, dirZ: 0, lobe: -1,
  };
}

export class Merges {
  readonly items: Merge[] = Array.from({ length: MAX_MERGES }, createMerge);
  readonly completed: Completion[] = Array.from({ length: MAX_MERGES + 1 }, () => ({ lobe: -1, radius: 0, jellyRadius: 0 }));
  completedCount = 0;

  start(pickup: Pickup): Merge {
    let slot = this.items.find(item => !item.active);
    if (!slot) {
      // Everything is busy: the oldest finishes at once, its volume joining the jelly.
      slot = this.items.reduce((oldest, item) => (item.age > oldest.age ? item : oldest));
      this.finish(slot);
    }
    slot.active = true;
    slot.age = 0;
    slot.kind = pickup.kind; slot.look = pickup.look; slot.color = pickup.color; slot.color2 = pickup.color2; slot.seed = pickup.seed;
    slot.radius = pickup.radius; slot.jellyRadius = pickup.jellyRadius; slot.volume = pickup.volume;
    slot.dirX = pickup.dx; slot.dirY = pickup.dy; slot.dirZ = pickup.dz;
    slot.lobe = -1;
    setMergeSpec(slot.spec, pickup.distance, pickup.jellyRadius, pickup.radius);
    slot.total = mergeDuration(slot.spec);
    mergeShape(slot.spec, 0, slot.shape);
    return slot;
  }

  /** Advance every merge; the finished ones are listed in `completed` until the next call. */
  update(dt: number) {
    // Completions queued by start() (an evicted merge) are kept for this frame's reader.
    for (const item of this.items) {
      if (!item.active) continue;
      item.age += dt;
      if (item.age >= item.total) this.finish(item);
      else mergeShape(item.spec, item.age, item.shape);
    }
  }

  /** Call after reading `completed`, once per frame. */
  clearCompleted() {
    this.completedCount = 0;
  }

  /** Volume the jelly has been given but is still being shown as the mushroom. */
  pendingVolume(): number {
    let pending = 0;
    for (const item of this.items) if (item.active) pending += item.volume * (1 - item.shape.transferred);
    return pending;
  }

  get activeCount(): number {
    let count = 0;
    for (const item of this.items) if (item.active) count++;
    return count;
  }

  reset() {
    for (const item of this.items) { item.active = false; item.lobe = -1; }
    this.completedCount = 0;
  }

  private finish(item: Merge) {
    item.active = false;
    mergeShape(item.spec, item.total, item.shape);
    const done = this.completed[this.completedCount++];
    done.lobe = item.lobe; done.radius = item.radius; done.jellyRadius = item.jellyRadius;
    item.lobe = -1;
  }
}
