import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GAME_REPO_URL, JELLY_TECH_URL, SPLASH_TITLE } from '../src/app/splash-links.ts';
import { NAME_MAX_LETTERS } from '../src/shared/run-rules.ts';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the splash credits the same projects as NOTICE.md and the README, and links to them', () => {
  assert.ok(read('NOTICE.md').includes(JELLY_TECH_URL), 'NOTICE.md names the Jelly Baby repository the splash links to');
  assert.ok(read('README.md').includes(JELLY_TECH_URL), 'README.md names it too');
  assert.ok(read('README.md').includes(GAME_REPO_URL) || read('NOTICE.md').includes(GAME_REPO_URL) || read('package.json').includes('boxabirds/jellyroll'), 'the repository the splash links to is this one');
  for (const url of [GAME_REPO_URL, JELLY_TECH_URL]) assert.match(url, /^https:\/\/github\.com\/[\w-]+\/[\w-]+$/);
});

test('the title fits the jelly-letter stage: no more letters than it holds, words split by one space', () => {
  const letters = [...SPLASH_TITLE].filter(c => c !== ' ');
  assert.ok(letters.length <= NAME_MAX_LETTERS, `${letters.length} letters`);
  assert.ok(letters.every(c => /[A-Z]/.test(c)));
  assert.ok(!/ {2}|^ | $/.test(SPLASH_TITLE));
});
