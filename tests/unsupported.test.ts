import assert from 'node:assert/strict';
import test from 'node:test';
import { INTERRUPTED_COPY, InterruptedError, UnsupportedError, describeUnsupported, type UnsupportedKind } from '../src/render/unsupported.ts';

const KINDS: UnsupportedKind[] = ['no-webgpu', 'no-adapter', 'insecure'];

test('every way the device can be unsupported has a plain title, a reason and one thing to try', () => {
  const titles = new Set<string>();
  for (const kind of KINDS) {
    const copy = describeUnsupported(kind);
    assert.ok(copy.title && copy.message && copy.hint, kind);
    assert.ok(!/navigator\.gpu|adapter|undefined/i.test(copy.message + copy.hint), `${kind}: jargon in the copy`);
    titles.add(copy.title);
  }
  assert.equal(titles.size, KINDS.length, 'each case says something different');
});

test('the error carries its kind, so the page can tell it from a bug', () => {
  const error = new UnsupportedError('no-webgpu', 'detail');
  assert.ok(error instanceof Error && error.kind === 'no-webgpu' && error.message === 'detail');
});

test('a lost graphics device is its own kind of error, with plain words for the player', () => {
  const error = new InterruptedError('WebGPU device was destroyed: out of memory');
  assert.ok(error instanceof Error && error instanceof InterruptedError);
  assert.ok(error.message.includes('out of memory'), 'the browser\'s reason is kept for the details');
  assert.ok(INTERRUPTED_COPY.title && INTERRUPTED_COPY.message && INTERRUPTED_COPY.hint);
  assert.ok(!/webgpu|device|navigator/i.test(INTERRUPTED_COPY.message + INTERRUPTED_COPY.hint), 'no jargon in the copy');
});
