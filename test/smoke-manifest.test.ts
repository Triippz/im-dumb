import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  loadSmokeManifest,
  loadSmokeQuarantine,
  parseSmokeManifest,
  parseSmokeQuarantine,
  resolveBlockingCaseIds,
  validateSmokeCaseIds,
} from '../src/smoke-manifest.ts';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const goldenIds = readdirSync(path.join(repoRoot, 'eval/golden/cases'))
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.slice(0, -'.json'.length))
  .sort();

test('parseSmokeManifest: accepts versioned case_ids list', () => {
  const manifest = parseSmokeManifest({
    version: 1,
    case_ids: ['persona-baseline-common-dns', 'jargon-decomposition-bft-consensus'],
  });
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.caseIds, [
    'jargon-decomposition-bft-consensus',
    'persona-baseline-common-dns',
  ]);
});

test('parseSmokeManifest: rejects unknown fields and empty ids', () => {
  assert.throws(() => parseSmokeManifest({ version: 1, case_ids: [], extra: true }), /unknown/i);
  assert.throws(() => parseSmokeManifest({ version: 1, case_ids: [''] }), /non-empty/);
  assert.throws(() => parseSmokeManifest({ version: 1, case_ids: ['a', 'a'] }), /duplicate/);
});

test('parseSmokeQuarantine: accepts empty quarantine', () => {
  const quarantine = parseSmokeQuarantine({ version: 1, case_ids: [] });
  assert.deepEqual(quarantine.caseIds, []);
});

test('validateSmokeCaseIds: every id must exist in the golden set', () => {
  const ok = validateSmokeCaseIds(['persona-baseline-common-dns'], goldenIds);
  assert.deepEqual(ok, []);
  const bad = validateSmokeCaseIds(['persona-baseline-common-dns', 'not-a-real-case'], goldenIds);
  assert.deepEqual(bad, ['not-a-real-case']);
});

test('resolveBlockingCaseIds: drops quarantined ids, keeps report order from manifest', () => {
  const blocking = resolveBlockingCaseIds(
    ['case-a', 'case-b', 'case-c'],
    ['case-b'],
  );
  assert.deepEqual(blocking, ['case-a', 'case-c']);
});

test('checked-in smoke-manifest.json ids are golden-known, sorted, and cover categories', () => {
  const manifest = loadSmokeManifest(path.join(repoRoot, 'eval/smoke-manifest.json'));
  assert.equal(manifest.version, 1);
  assert.ok(manifest.caseIds.length >= 6, 'smoke set should stay small but cover categories');
  assert.ok(manifest.caseIds.length <= 16, 'smoke set must stay cheaper than full golden');
  assert.deepEqual(manifest.caseIds, [...manifest.caseIds].sort());
  assert.deepEqual(validateSmokeCaseIds(manifest.caseIds, goldenIds), []);

  const categories = new Set<string>();
  for (const id of manifest.caseIds) {
    const raw = JSON.parse(
      readFileSync(path.join(repoRoot, 'eval/golden/cases', `${id}.json`), 'utf8'),
    ) as { category: string };
    categories.add(raw.category);
  }
  for (const required of [
    'persona-baseline',
    'jargon-decomposition',
    'adhd-pair',
    'adversarial',
    'comprehension-gate',
    'profile-adaptation',
  ]) {
    assert.ok(categories.has(required), `smoke missing category ${required}`);
  }
});

test('checked-in smoke-quarantine.json parses and only lists known or empty ids', () => {
  const quarantine = loadSmokeQuarantine(path.join(repoRoot, 'eval/smoke-quarantine.json'));
  assert.equal(quarantine.version, 1);
  assert.deepEqual(validateSmokeCaseIds(quarantine.caseIds, goldenIds), []);
  for (const id of quarantine.caseIds) {
    assert.ok(
      loadSmokeManifest(path.join(repoRoot, 'eval/smoke-manifest.json')).caseIds.includes(id),
      `quarantine id ${id} should be in the smoke manifest`,
    );
  }
});
