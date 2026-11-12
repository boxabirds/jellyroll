/**
 * The Titan One letter outlines. The data is in font units (1000 to the em) with the y axis pointing up, as the typeface
 * format has it: `m x y` starts a contour, `l x y` is a line, and `q x y cx cy` is a quadratic curve to (x, y) bending
 * towards (cx, cy). Coordinates are absolute.
 */
import letters from '../assets/titan-letters.json' with { type: 'json' };

export interface Glyph { ha: number; o: string }

export const GLYPHS: Readonly<Record<string, Glyph>> = letters.glyphs;
/** Font units to the em. */
export const UNITS_PER_EM = 1000;

export type Segment = { kind: 'm' | 'l'; x: number; y: number } | { kind: 'q'; x: number; y: number; cx: number; cy: number };

const COMMAND = /([mlq])\s*([^mlq]*)/g;

/** The outline as drawing steps, in font units. */
export function segments(outline: string): Segment[] {
  const out: Segment[] = [];
  for (const [, kind, numbers] of outline.matchAll(COMMAND)) {
    const v = numbers.trim().split(/\s+/).map(Number);
    if (kind === 'q') out.push({ kind, x: v[0], y: v[1], cx: v[2], cy: v[3] });
    else out.push({ kind: kind as 'm' | 'l', x: v[0], y: v[1] });
  }
  return out;
}

/** Contours as lists of their points (curve control points included), for checks that need the shape. */
export function contours(outline: string): number[][][] {
  const result: number[][][] = [];
  for (const s of segments(outline)) {
    if (s.kind === 'm') result.push([]);
    const current = result[result.length - 1];
    if (s.kind === 'q') current.push([s.cx, s.cy]);
    current.push([s.x, s.y]);
  }
  return result;
}

/** Signed area of a polygon (shoelace); the sign says which way it winds. */
export function signedArea(points: number[][]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}
