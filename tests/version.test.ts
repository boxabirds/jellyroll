import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { APP_VERSION, GIT_SHA, versionLabel } from '../src/shared/version.ts';

test('outside a build the version reads "dev", and a label is always something a person can read', () => {
  assert.equal(APP_VERSION, 'dev');
  assert.equal(GIT_SHA, 'dev');
  assert.equal(versionLabel(), 'vdev · dev');
});

test('package.json carries a semantic version, and the changelog has an entry for it', () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.ok(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').includes(`## ${version}`), `CHANGELOG.md has no "## ${version}" heading`);
});
