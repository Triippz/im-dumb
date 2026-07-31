import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  GOLDEN_CATEGORIES,
  validateGoldenCase,
  validateGoldenCaseSet,
  verifyManifest,
  type GoldenCase,
  type GoldenCaseFile,
  type GoldenManifest,
} from '../src/golden-schema.ts';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const goldenDir = path.join(repoRoot, 'eval', 'golden');
const casesDir = path.join(goldenDir, 'cases');

const MIN_CASES = 25;
const MAX_CASES = 30;

function caseFilenames(): string[] {
  return readdirSync(casesDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

function loadCaseFiles(): GoldenCaseFile[] {
  return caseFilenames().map((filename) => {
    const contents = readFileSync(path.join(casesDir, filename), 'utf8');
    const parsed = JSON.parse(contents) as { id: string };
    return { id: parsed.id, path: `eval/golden/cases/${filename}`, contents };
  });
}

function loadCases(): GoldenCase[] {
  return loadCaseFiles().map((file) => JSON.parse(file.contents) as GoldenCase);
}

function readManifest(): GoldenManifest {
  return JSON.parse(readFileSync(path.join(goldenDir, 'manifest.json'), 'utf8')) as GoldenManifest;
}

// ---------------------------------------------------------------------------
// Every case file loads and is individually schema-valid (D14)
// ---------------------------------------------------------------------------

test('golden dataset: every case file parses as JSON and passes validateGoldenCase', () => {
  for (const file of loadCaseFiles()) {
    const parsed: unknown = JSON.parse(file.contents);
    const result = validateGoldenCase(parsed);
    assert.deepEqual(result.errors, [], `${file.path}: ${result.errors.join('; ')}`);
    assert.equal(result.valid, true, `${file.path} should be a valid golden case`);
  }
});

test('golden dataset: each case file is named "<id>.json" (stable, discoverable ids)', () => {
  for (const file of loadCaseFiles()) {
    const filename = path.basename(file.path);
    assert.equal(`${file.id}.json`, filename, `filename should match case id for ${filename}`);
  }
});

// ---------------------------------------------------------------------------
// Set-level invariants: unique ids, pair invariant (D14)
// ---------------------------------------------------------------------------

test('golden dataset: the full case set passes validateGoldenCaseSet (unique ids, pair invariant)', () => {
  const result = validateGoldenCaseSet(loadCases());
  assert.deepEqual(result, { valid: true, errors: [] });
});

// ---------------------------------------------------------------------------
// Count + category coverage (prd.md §9.4 categories 1, 2, 3, 6 / D14 enum)
// ---------------------------------------------------------------------------

test(`golden dataset: total case count is within the M1 draft range [${MIN_CASES}, ${MAX_CASES}]`, () => {
  const count = loadCases().length;
  assert.ok(count >= MIN_CASES && count <= MAX_CASES, `expected ${MIN_CASES}-${MAX_CASES} cases, got ${count}`);
});

test('golden dataset: every M1 category (persona-baseline, jargon-decomposition, adhd-pair, adversarial) is represented', () => {
  const cases = loadCases();
  for (const category of GOLDEN_CATEGORIES) {
    const count = cases.filter((c) => c.category === category).length;
    assert.ok(count > 0, `expected at least one case in category "${category}"`);
  }
});

test('golden dataset: at least 3 persona-baseline cases, covering all 3 vocabulary_level personas', () => {
  const cases = loadCases().filter((c) => c.category === 'persona-baseline');
  assert.ok(cases.length >= 3, `expected >=3 persona-baseline cases, got ${cases.length}`);
  const levels = new Set(cases.map((c) => c.profile.vocabulary_level));
  for (const level of ['common', 'technical-ok', 'expert']) {
    assert.ok(levels.has(level), `expected a persona-baseline case with profile.vocabulary_level "${level}"`);
  }
});

test('golden dataset: adhd-pair cases exist only as complete, pair_id-linked pairs', () => {
  const cases = loadCases().filter((c) => c.category === 'adhd-pair');
  assert.ok(cases.length >= 2, `expected >=2 adhd-pair cases, got ${cases.length}`);
  assert.equal(cases.length % 2, 0, 'adhd-pair cases must come in complete pairs');
  for (const c of cases) {
    assert.ok(c.pair_id, `adhd-pair case "${c.id}" must declare a pair_id`);
  }
  const pairIds = new Set(cases.map((c) => c.pair_id));
  assert.equal(pairIds.size, cases.length / 2, 'expected each pair_id to name exactly one pair');
});

test('golden dataset: adversarial cases cover both jargon-leakage and unsafe-oversimplification', () => {
  const cases = loadCases().filter((c) => c.category === 'adversarial');
  assert.ok(cases.some((c) => c.id.includes('jargon-leakage')), 'expected an adversarial jargon-leakage case');
  assert.ok(
    cases.some((c) => c.id.includes('unsafe-oversimplification')),
    'expected an adversarial unsafe-oversimplification case',
  );
});

// ---------------------------------------------------------------------------
// Manifest drift (D14 — sorted case ids + per-file SHA-256)
// ---------------------------------------------------------------------------

test('golden dataset: manifest.json has no drift against the on-disk case files', () => {
  const result = verifyManifest(readManifest(), loadCaseFiles());
  assert.deepEqual(result, { drifted: false, issues: [] });
});

test('golden dataset: manifest.json entries are sorted by case id', () => {
  const ids = readManifest().cases.map((entry) => entry.id);
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(ids, sorted);
});

test('golden dataset: manifest.json records a 64-char hex sha256 per case', () => {
  for (const entry of readManifest().cases) {
    assert.match(entry.sha256, /^[0-9a-f]{64}$/, `entry for "${entry.id}" should have a sha256 hex digest`);
  }
});

// ---------------------------------------------------------------------------
// README.md is the normative dataset document (D14)
// ---------------------------------------------------------------------------

test('golden dataset README documents category mapping, D14 schema, v2 forward-note, and the edit sign-off rule', () => {
  const readme = readFileSync(path.join(goldenDir, 'README.md'), 'utf8');
  for (const category of GOLDEN_CATEGORIES) {
    assert.ok(readme.includes(category), `README should mention category "${category}"`);
  }
  for (const field of [
    'id',
    'category',
    'prompt',
    'profile',
    'reference_facts',
    'must_preserve',
    'expected_checks',
    'pair_id',
  ]) {
    assert.ok(readme.includes(field), `README should document the "${field}" field`);
  }
  assert.match(readme, /schema[- ]v(?:ersion )?2/i, 'README should carry the schema-v2 forward note');
  assert.match(readme, /turns/, 'README should mention the v2 turns[] field for M2 categories 4-5');
  assert.match(readme, /sign-?off/i, 'README should state the reviewer sign-off rule for editing existing cases');
  assert.match(readme, /sha-?256/i, 'README should document the manifest sha256 hashing scheme');
});
