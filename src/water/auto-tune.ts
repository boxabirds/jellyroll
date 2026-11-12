/**
 * A tiny benchmark that picks the water's settings for the device it is on. It tries a list of (intensity, render scale)
 * pairs from the best looking down, drawing the real scene (with a splash going) a few frames each and timing how long the
 * GPU takes per frame, and stops at the first that holds the frame budget. The first few frames of each are thrown away
 * (shaders compile and buffers resize then), and the median of the rest is used, so one hitch does not decide it.
 * It is all the game needs to do the same thing at load: give it a function that draws one frame and says how long it took.
 */
export type Candidate = { intensity: number; scale: number; label: string };

/** From best looking to cheapest. Render scale is the share of the screen's pixels drawn. */
export const CANDIDATES: readonly Candidate[] = [
  { intensity: 100, scale: 1, label: 'High, full resolution' },
  { intensity: 80, scale: 1, label: 'High, full resolution' },
  { intensity: 60, scale: 0.9, label: 'Medium' },
  { intensity: 45, scale: 0.8, label: 'Medium, slightly reduced resolution' },
  { intensity: 30, scale: 0.7, label: 'Low' },
  { intensity: 15, scale: 0.6, label: 'Low, reduced resolution' },
  { intensity: 0, scale: 0.5, label: 'Minimal' },
];

export type TuneResult = { candidate: Candidate; medianMs: number; tried: { candidate: Candidate; medianMs: number }[]; totalMs: number };

const WARMUP_FRAMES = 4;
const MEASURED_FRAMES = 9;
/** 60 frames a second is 16.7 ms; aim a little under it, so there is room for the rest of the game. */
export const FRAME_BUDGET_MS = 14;
/** If a candidate is this many times over budget, the next one is skipped as well (it would be hopeless too). */
const SKIP_FACTOR = 3.5;
const MAX_TOTAL_MS = 6000;

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * @param apply set the water to this intensity and render scale (may take a moment, e.g. a new shader)
 * @param frame draw one frame and resolve with the milliseconds the GPU took to finish it
 * @param splash start a splash, so the spray is part of what is timed
 */
export async function autoTune(
  apply: (candidate: Candidate) => void | Promise<void>,
  frame: () => Promise<number>,
  splash: () => void,
  budgetMs = FRAME_BUDGET_MS,
  candidates: readonly Candidate[] = CANDIDATES,
): Promise<TuneResult> {
  const started = performance.now();
  const tried: { candidate: Candidate; medianMs: number }[] = [];
  let skip = 0;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const last = i === candidates.length - 1;
    if (skip > 0 && !last) { skip--; continue; }
    await apply(candidate);
    splash();
    for (let n = 0; n < WARMUP_FRAMES; n++) await frame();
    const times: number[] = [];
    for (let n = 0; n < MEASURED_FRAMES; n++) times.push(await frame());
    const medianMs = median(times);
    tried.push({ candidate, medianMs });
    if (medianMs <= budgetMs || last) return { candidate, medianMs, tried, totalMs: performance.now() - started };
    if (medianMs > budgetMs * SKIP_FACTOR) skip = 1;
    if (performance.now() - started > MAX_TOTAL_MS) {
      // Out of time: take the cheapest.
      const cheapest = candidates[candidates.length - 1];
      await apply(cheapest);
      return { candidate: cheapest, medianMs, tried, totalMs: performance.now() - started };
    }
  }
  throw new Error('no candidates');
}
