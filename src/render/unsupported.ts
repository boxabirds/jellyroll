/** The browser or machine cannot run the game at all (as opposed to the game having a bug). Kept free of imports so the page can show it at once. */
export type UnsupportedKind = 'insecure' | 'no-webgpu' | 'no-adapter';

export class UnsupportedError extends Error {
  readonly kind: UnsupportedKind;
  constructor(kind: UnsupportedKind, message: string) {
    super(message);
    this.name = 'UnsupportedError';
    this.kind = kind;
  }
}

export interface UnsupportedCopy { title: string; message: string; hint: string }

/** What to tell the player: what is missing, in plain words, then the one thing most likely to fix it. */
export function describeUnsupported(kind: UnsupportedKind): UnsupportedCopy {
  switch (kind) {
    case 'no-webgpu':
      return {
        title: 'Jellyland needs WebGPU.',
        message: "This browser can't run WebGPU, the graphics technology the game is built on.",
        hint: 'Try an up-to-date Chrome, Edge or Safari. If you already use one, update it and reload.',
      };
    case 'no-adapter':
      return {
        title: "Can't find a graphics chip to use.",
        message: 'Your browser supports WebGPU, but it found no graphics hardware it could use.',
        hint: "Check that hardware acceleration is turned on in the browser's settings, update your graphics drivers, then reload.",
      };
    case 'insecure':
      return {
        title: 'Please open the game over https.',
        message: 'Browsers only allow WebGPU on secure pages.',
        hint: 'Use the https:// address of the game, then reload.',
      };
  }
}

/**
 * The graphics were taken away while the game ran (a phone short of memory, or the page sent to the background): not a bug in the
 * game and not a device that cannot run it, so the page says so, and starts over rather than showing a stack of details.
 */
/** Sent on the window when the graphics are lost, so the game can save its run at once. */
export const INTERRUPTED_EVENT = 'jellyland-interrupted';

export class InterruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InterruptedError';
  }
}

export const INTERRUPTED_COPY: UnsupportedCopy = {
  title: 'The graphics were interrupted.',
  message: "Your phone stopped the game's graphics. That usually happens when it is short of memory, or after the game was in the background.",
  hint: 'Tap Try again to start over.',
};
