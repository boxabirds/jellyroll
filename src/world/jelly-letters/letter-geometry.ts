/*
 * Ported from the owner's unixjelly project (GPL-3.0), src/engine/shell.html `makeLetter`. Changes: the outline is
 * read straight from the bundled Titan One data instead of a three.js Font object.
 */
import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLYPHS, UNITS_PER_EM, segments } from '../../game/glyphs.ts';

/** Extrusion depth, bevel depth and bevel width, as shares of the letter size. */
const DEPTH = 0.3;
const BEVEL_THICKNESS = 0.09;
const BEVEL_SIZE = 0.05;
const BEVEL_SEGMENTS = 4;
const CURVE_SEGMENTS = 7;
/** Vertices closer than this share of the size are joined, so the skin is one smooth surface. */
const WELD = 1e-4;
/** How much jelly the light crosses through the middle of a letter, as a share of its size, and the least anywhere. */
const FACE_DEPTH = 0.48;
const THIN_LEAST = 0.04;
const THICK_MOST = 1.2;
const WALL_EPSILON = 0.01;

export interface Point { x: number; y: number }
export interface Letter {
  geometry: THREE.BufferGeometry;
  /** The outline polygons (outer edge and holes), standing on y = 0 and centred on x = 0, for "is this point inside the letter". */
  polygons: Point[][];
  box: THREE.Box3;
  /** How far the letter's centre sat from its origin before it was centred. */
  centerShift: number;
}

/** The letter's outline as three.js shapes, `size` metres tall to the em. */
function shapesOf(character: string, size: number): THREE.Shape[] {
  const glyph = GLYPHS[character] ?? GLYPHS['?'] ?? GLYPHS['O'];
  const scale = size / UNITS_PER_EM;
  const path = new THREE.ShapePath();
  for (const s of segments(glyph.o)) {
    if (s.kind === 'm') path.moveTo(s.x * scale, s.y * scale);
    else if (s.kind === 'l') path.lineTo(s.x * scale, s.y * scale);
    else path.quadraticCurveTo(s.cx * scale, s.cy * scale, s.x * scale, s.y * scale);
  }
  return path.toShapes();
}

const cache = new Map<string, Omit<Letter, 'geometry'> & { geometry: THREE.BufferGeometry }>();

/** A letter's body: extruded, bevelled, welded, centred, with the thickness of jelly behind each point (`aThick`). */
export function makeLetter(character: string, size: number): Letter {
  const key = `${character}:${size}`;
  const cached = cache.get(key);
  if (cached) return { ...cached, geometry: cached.geometry.clone() };
  const shapes = shapesOf(character, size);
  let geometry: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shapes, {
    depth: size * DEPTH, curveSegments: CURVE_SEGMENTS, bevelEnabled: true,
    bevelThickness: size * BEVEL_THICKNESS, bevelSize: size * BEVEL_SIZE, bevelSegments: BEVEL_SEGMENTS,
  });
  geometry.deleteAttribute('uv'); geometry.deleteAttribute('normal');
  geometry = mergeVertices(geometry, size * WELD);
  geometry.computeVertexNormals(); geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const shiftX = -(bb.min.x + bb.max.x) / 2, shiftY = -bb.min.y, shiftZ = -(bb.min.z + bb.max.z) / 2;
  geometry.translate(shiftX, shiftY, shiftZ); geometry.computeBoundingBox();
  const polygons = shapes.flatMap(shape => {
    const extracted = shape.extractPoints(CURVE_SEGMENTS);
    return [extracted.shape, ...extracted.holes].map(ring => ring.map(v => ({ x: v.x + shiftX, y: v.y + shiftY })));
  });
  // The thickness behind each point: the full depth on the front and back faces, and on the walls the stroke width, found by
  // a 2D ray across the outline. Worked out once per letter and size; it rides the vertices, so it squishes with the jelly.
  const positions = geometry.attributes.position.array as Float32Array, normals = geometry.attributes.normal.array as Float32Array;
  const depth = size * FACE_DEPTH, thick = new Float32Array(positions.length / 3);
  for (let i = 0; i < thick.length; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], nx = normals[i * 3], ny = normals[i * 3 + 1];
    const length = Math.hypot(nx, ny) || 1, dx = -nx / length, dy = -ny / length;
    let best = size * THICK_MOST;
    for (const ring of polygons) {
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const ex = ring[a].x - ring[b].x, ey = ring[a].y - ring[b].y, denominator = dx * ey - dy * ex;
        if (Math.abs(denominator) < 1e-12) continue;
        const wx = ring[b].x - x, wy = ring[b].y - y;
        const t = (wx * ey - wy * ex) / denominator, u = (wx * dy - wy * dx) / denominator;
        if (t > size * WALL_EPSILON && u >= 0 && u <= 1 && t < best) best = t;
      }
    }
    const face = Math.abs(normals[i * 3 + 2]);
    thick[i] = Math.max(size * THIN_LEAST, face * depth + (1 - face) * best);
  }
  geometry.setAttribute('aThick', new THREE.BufferAttribute(thick, 1));
  const entry = { geometry, polygons, box: geometry.boundingBox!.clone(), centerShift: -shiftX };
  cache.set(key, entry);
  return { ...entry, geometry: geometry.clone() };
}

/** How wide a character is (its advance), in metres at this size. */
export function advanceOf(character: string, size: number): number {
  return (GLYPHS[character] ?? GLYPHS['O']).ha * size / UNITS_PER_EM;
}

/** Whether (x, y) is inside the outline (even-odd). */
export function inside(polygons: Point[][], x: number, y: number): boolean {
  let hit = false;
  for (const p of polygons) {
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i].y > y) !== (p[j].y > y) && x < (p[j].x - p[i].x) * (y - p[i].y) / (p[j].y - p[i].y) + p[i].x) hit = !hit;
    }
  }
  return hit;
}
