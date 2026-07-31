import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHECKER_IDS } from '../src/checkers.ts';
import {
  GOLDEN_CATEGORIES,
  EXPECTED_RESULTS,
  validateGoldenCase,
  validateGoldenCaseSet,
  generateManifest,
  verifyManifest,
  type GoldenCase,
} from '../src/golden-schema.ts';

const VALID_CASE: Record<string, unknown> = {
  id: 'persona-baseline-001',
  category: 'persona-baseline',
  prompt: 'Explain how DNS works to a beginner.',
  profile: { vocabulary_level: 'common', adhd_mode: false },
  reference_facts: ['DNS resolves domain names to IP addresses.'],
  must_preserve: ['DNS', 'IP address'],
  expected_checks: [{ checker: 'sentence-cap', expect: 'pass' }],
};

function withCase(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...VALID_CASE, ...overrides };
}

// ---------------------------------------------------------------------------
// D14 — golden case schema validation
// ---------------------------------------------------------------------------

test('validateGoldenCase: a fully-populated valid case is valid', () => {
  const result = validateGoldenCase(VALID_CASE);
  assert.deepEqual(result, { valid: true, errors: [] });
});

test('validateGoldenCase: a valid case with pair_id is valid', () => {
  const result = validateGoldenCase(withCase({ pair_id: 'pair-1' }));
  assert.equal(result.valid, true);
});

test('validateGoldenCase: non-object input is invalid', () => {
  for (const bad of [null, 42, 'oops', ['a']]) {
    const result = validateGoldenCase(bad);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  }
});

test('validateGoldenCase: missing or empty id is invalid', () => {
  for (const bad of [{ ...VALID_CASE, id: undefined }, { ...VALID_CASE, id: '' }, { ...VALID_CASE, id: 42 }]) {
    const result = validateGoldenCase(bad);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('"id"')));
  }
});

test('validateGoldenCase: category must be one of the enum values', () => {
  assert.deepEqual([...GOLDEN_CATEGORIES], ['persona-baseline', 'jargon-decomposition', 'adhd-pair', 'adversarial']);
  const result = validateGoldenCase(withCase({ category: 'not-a-category' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('"category"')));
});

test('validateGoldenCase: missing or empty prompt is invalid', () => {
  for (const bad of [{ ...VALID_CASE, prompt: undefined }, { ...VALID_CASE, prompt: '' }]) {
    const result = validateGoldenCase(bad);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('"prompt"')));
  }
});

test('validateGoldenCase: profile must be an object', () => {
  for (const bad of ['not-an-object', 42, null, undefined]) {
    const result = validateGoldenCase(withCase({ profile: bad }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('"profile"')));
  }
});

test('validateGoldenCase: reference_facts and must_preserve must be arrays of <=20 strings, each <=200 chars', () => {
  for (const field of ['reference_facts', 'must_preserve']) {
    assert.equal(validateGoldenCase(withCase({ [field]: 'not-an-array' })).valid, false);
    assert.equal(
      validateGoldenCase(withCase({ [field]: Array.from({ length: 21 }, (_, i) => `fact-${i}`) })).valid,
      false,
    );
    assert.equal(validateGoldenCase(withCase({ [field]: ['x'.repeat(201)] })).valid, false);
    assert.equal(validateGoldenCase(withCase({ [field]: ['x'.repeat(200)] })).valid, true);
  }
});

test('validateGoldenCase: expected_checks must be a non-empty array of {checker, expect}', () => {
  assert.equal(validateGoldenCase(withCase({ expected_checks: [] })).valid, false);
  assert.equal(validateGoldenCase(withCase({ expected_checks: 'nope' })).valid, false);

  const badChecker = validateGoldenCase(withCase({ expected_checks: [{ checker: 'not-a-real-checker', expect: 'pass' }] }));
  assert.equal(badChecker.valid, false);
  assert.ok(badChecker.errors.some((e) => e.includes('checker')));

  const badExpect = validateGoldenCase(withCase({ expected_checks: [{ checker: 'sentence-cap', expect: 'maybe' }] }));
  assert.equal(badExpect.valid, false);
  assert.ok(badExpect.errors.some((e) => e.includes('expect')));

  assert.deepEqual([...EXPECTED_RESULTS], ['pass', 'fail', 'warn']);
  for (const checker of CHECKER_IDS) {
    assert.equal(validateGoldenCase(withCase({ expected_checks: [{ checker, expect: 'pass' }] })).valid, true);
  }
});

test('validateGoldenCase: pair_id must be a non-empty string when present', () => {
  assert.equal(validateGoldenCase(withCase({ pair_id: '' })).valid, false);
  assert.equal(validateGoldenCase(withCase({ pair_id: 42 })).valid, false);
});

// ---------------------------------------------------------------------------
// D14 — pair invariant + case-id uniqueness across a set
// ---------------------------------------------------------------------------

function pairCase(id: string, pairId: string, adhdMode: boolean, extra: Record<string, unknown> = {}): GoldenCase {
  return {
    id,
    category: 'adhd-pair',
    prompt: 'Explain recursion.',
    profile: { vocabulary_level: 'common', adhd_mode: adhdMode, ...extra },
    reference_facts: ['A function that calls itself.'],
    must_preserve: ['recursion'],
    expected_checks: [{ checker: 'adhd-structure', expect: 'pass' }],
    pair_id: pairId,
  };
}

test('validateGoldenCaseSet: a well-formed adhd_mode pair is valid', () => {
  const result = validateGoldenCaseSet([pairCase('adhd-1a', 'pair-1', false), pairCase('adhd-1b', 'pair-1', true)]);
  assert.deepEqual(result, { valid: true, errors: [] });
});

test('validateGoldenCaseSet: differing profile fields other than profile order do not falsely trigger (key-order independence)', () => {
  const a = pairCase('adhd-2a', 'pair-2', false);
  const b: GoldenCase = { ...pairCase('adhd-2b', 'pair-2', true), profile: { adhd_mode: true, vocabulary_level: 'common' } };
  const result = validateGoldenCaseSet([a, b]);
  assert.equal(result.valid, true);
});

test('validateGoldenCaseSet: a pair_id naming only one case is invalid', () => {
  const result = validateGoldenCaseSet([pairCase('solo-1', 'pair-3', false)]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('pair-3') && e.includes('exactly 2')));
});

test('validateGoldenCaseSet: a pair_id naming three cases is invalid', () => {
  const result = validateGoldenCaseSet([
    pairCase('trio-1', 'pair-4', false),
    pairCase('trio-2', 'pair-4', true),
    pairCase('trio-3', 'pair-4', true),
  ]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('pair-4') && e.includes('exactly 2')));
});

test('validateGoldenCaseSet: a pair with different prompts is invalid', () => {
  const a = pairCase('mismatch-1', 'pair-5', false);
  const b = { ...pairCase('mismatch-2', 'pair-5', true), prompt: 'A different prompt entirely.' };
  const result = validateGoldenCaseSet([a, b]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('identical prompt')));
});

test('validateGoldenCaseSet: a pair differing on a profile field other than adhd_mode is invalid', () => {
  const a = pairCase('profdiff-1', 'pair-6', false);
  const b = pairCase('profdiff-2', 'pair-6', true, { vocabulary_level: 'expert' });
  const result = validateGoldenCaseSet([a, b]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('identical profile except adhd_mode')));
});

test('validateGoldenCaseSet: a pair sharing the same adhd_mode value on both sides is invalid', () => {
  const result = validateGoldenCaseSet([pairCase('same-1', 'pair-7', false), pairCase('same-2', 'pair-7', false)]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('differ on adhd_mode')));
});

test('validateGoldenCaseSet: duplicate case ids across the set are invalid', () => {
  // Same pair_id + otherwise-valid pair so the only failure is the id collision.
  const result = validateGoldenCaseSet([pairCase('dup-1', 'pair-8', false), pairCase('dup-1', 'pair-8', true)]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('duplicate case id') && e.includes('dup-1')));
});

// ---------------------------------------------------------------------------
// D14 — manifest generation + SHA-256 drift verification
// ---------------------------------------------------------------------------

const FILE_A = { id: 'case-b', path: 'eval/golden/case-b.json', contents: '{"id":"case-b"}' };
const FILE_B = { id: 'case-a', path: 'eval/golden/case-a.json', contents: '{"id":"case-a"}' };

test('generateManifest: sorts entries by case id and computes a 64-char hex sha256 per file', () => {
  const manifest = generateManifest([FILE_A, FILE_B]);
  assert.deepEqual(manifest.cases.map((c) => c.id), ['case-a', 'case-b']);
  for (const entry of manifest.cases) {
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  }
});

test('generateManifest: is deterministic for identical contents and differs when contents differ', () => {
  const first = generateManifest([FILE_A]);
  const second = generateManifest([FILE_A]);
  assert.equal(first.cases[0]!.sha256, second.cases[0]!.sha256);

  const changed = generateManifest([{ ...FILE_A, contents: '{"id":"case-b","extra":true}' }]);
  assert.notEqual(first.cases[0]!.sha256, changed.cases[0]!.sha256);
});

test('verifyManifest: no drift when files match the recorded manifest', () => {
  const manifest = generateManifest([FILE_A, FILE_B]);
  const result = verifyManifest(manifest, [FILE_A, FILE_B]);
  assert.deepEqual(result, { drifted: false, issues: [] });
});

test('verifyManifest: detects a content hash change for an existing case', () => {
  const manifest = generateManifest([FILE_A, FILE_B]);
  const changed = { ...FILE_A, contents: '{"id":"case-b","mutated":true}' };
  const result = verifyManifest(manifest, [changed, FILE_B]);
  assert.equal(result.drifted, true);
  assert.ok(result.issues.some((i) => i.includes('case-b') && i.includes('hash')));
});

test('verifyManifest: detects a case removed from disk but still recorded in the manifest', () => {
  const manifest = generateManifest([FILE_A, FILE_B]);
  const result = verifyManifest(manifest, [FILE_B]);
  assert.equal(result.drifted, true);
  assert.ok(result.issues.some((i) => i.includes('case-b') && i.includes('missing on disk')));
});

test('verifyManifest: detects a case present on disk but missing from the manifest', () => {
  const manifest = generateManifest([FILE_B]);
  const result = verifyManifest(manifest, [FILE_A, FILE_B]);
  assert.equal(result.drifted, true);
  assert.ok(result.issues.some((i) => i.includes('case-b') && i.includes('missing from the manifest')));
});
