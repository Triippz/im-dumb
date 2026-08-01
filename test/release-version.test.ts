import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeNextVersion,
  parseConventionalSubjects,
  renderChangelogSection,
  type ReleaseBump,
} from '../src/release-version.ts';

function bumpFor(subjects: string[]): ReleaseBump {
  return parseConventionalSubjects(subjects).bump;
}

test('parseConventionalSubjects: feat is minor, fix/docs/chore are patch', () => {
  assert.equal(bumpFor(['feat: add slides']), 'minor');
  assert.equal(bumpFor(['fix: correct cap']), 'patch');
  assert.equal(bumpFor(['docs: update readme', 'chore: bump ci']), 'patch');
});

test('parseConventionalSubjects: bang or BREAKING CHANGE is major', () => {
  assert.equal(bumpFor(['feat!: drop cursor support']), 'major');
  assert.equal(bumpFor(['fix(profile)!: rename field']), 'major');
  assert.equal(bumpFor(['feat: x\n\nBREAKING CHANGE: schema moved']), 'major');
});

test('parseConventionalSubjects: highest bump wins across the range', () => {
  assert.equal(bumpFor(['docs: a', 'feat: b', 'fix: c']), 'minor');
  assert.equal(bumpFor(['docs: a', 'feat!: b', 'feat: c']), 'major');
});

test('parseConventionalSubjects: no conventional commits means no release', () => {
  const parsed = parseConventionalSubjects(['wip', 'merge branch main']);
  assert.equal(parsed.bump, 'none');
  assert.equal(parsed.entries.length, 0);
});

test('parseConventionalSubjects: groups entries by type and keeps the description', () => {
  const parsed = parseConventionalSubjects(['feat: add slides', 'fix(cli): exit 2 on bad target']);
  assert.deepEqual(
    parsed.entries.map((e) => ({ type: e.type, scope: e.scope, description: e.description })),
    [
      { type: 'feat', scope: undefined, description: 'add slides' },
      { type: 'fix', scope: 'cli', description: 'exit 2 on bad target' },
    ],
  );
});

test('computeNextVersion: applies the bump and zeroes lower parts', () => {
  assert.equal(computeNextVersion('0.2.0', 'patch'), '0.2.1');
  assert.equal(computeNextVersion('0.2.3', 'minor'), '0.3.0');
  assert.equal(computeNextVersion('0.2.3', 'major'), '1.0.0');
});

test('computeNextVersion: none returns the current version unchanged', () => {
  assert.equal(computeNextVersion('0.2.0', 'none'), '0.2.0');
});

test('computeNextVersion: rejects a non-semver current version', () => {
  assert.throws(() => computeNextVersion('v0.2', 'patch'), /semver/i);
});

test('renderChangelogSection: groups by type under a version heading', () => {
  const parsed = parseConventionalSubjects([
    'feat: add slides',
    'fix(cli): exit 2 on bad target',
    'docs: update readme',
  ]);
  const section = renderChangelogSection('0.3.0', '2026-08-01', parsed.entries);
  assert.match(section, /^## 0\.3\.0 - 2026-08-01$/m);
  assert.match(section, /### Features\n\n- add slides/);
  assert.match(section, /### Fixes\n\n- \*\*cli:\*\* exit 2 on bad target/);
  assert.match(section, /### Other\n\n- update readme/);
});
