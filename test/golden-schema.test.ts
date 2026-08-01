import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHECKER_IDS } from '../src/checkers.ts';
import {
  GOLDEN_CATEGORIES,
  PROMPT_ONLY_CATEGORIES,
  TURNS_ONLY_CATEGORIES,
  EXPECTED_RESULTS,
  GAP_TYPES,
  EXPECTED_ACTIONS,
  EXPECTED_FORMATS,
  validateGoldenCase,
  validateGoldenCaseSet,
  generateManifest,
  verifyManifest,
  type GoldenCase,
  type ExpectedAction,
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
// Golden schema v2 (M2 §3) — turns[], categories, action matrix
// ---------------------------------------------------------------------------

function userTurn(action: ExpectedAction, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    role: 'user',
    content: `user turn for ${action}`,
    expected_action: action,
    expected_question_count: action === 'diagnose' || action === 'rediagnose' ? 1 : 0,
    expected_format: 'default',
  };
  if (action === 'diagnose' || action === 'rediagnose') {
    base.expected_candidate_count = 3;
  }
  if (action === 'repair' || action === 'direct-repair' || action === 'record-resolution') {
    base.expected_gap_type = 'term';
  }
  if (action === 'record-resolution') {
    base.expected_known_gaps = [{ type: 'term', confidence: 0.75 }];
  }
  return { ...base, ...extra };
}

function assistantTurn(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { role: 'assistant', content: 'assistant reply', ...extra };
}

function turnsCase(turns: unknown[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'comprehension-gate-example',
    category: 'comprehension-gate',
    turns,
    profile: { vocabulary_level: 'common', adhd_mode: false },
    reference_facts: ['fact'],
    must_preserve: ['term'],
    expected_checks: [{ checker: 'sentence-cap', expect: 'pass' }],
    ...overrides,
  };
}

test('golden schema v2: new categories exist and are turns-only; v1 categories are prompt-only', () => {
  assert.deepEqual(
    [...GOLDEN_CATEGORIES],
    ['persona-baseline', 'jargon-decomposition', 'adhd-pair', 'adversarial', 'comprehension-gate', 'profile-adaptation', 'learning-asset'],
  );
  assert.deepEqual([...TURNS_ONLY_CATEGORIES], ['comprehension-gate', 'profile-adaptation']);
  assert.deepEqual(
    [...PROMPT_ONLY_CATEGORIES],
    ['persona-baseline', 'jargon-decomposition', 'adhd-pair', 'adversarial', 'learning-asset'],
  );
});

test('golden schema v2: GapType and ExpectedAction enums are exactly the closed taxonomy from the plan', () => {
  assert.deepEqual([...GAP_TYPES], ['term', 'step', 'assumption', 'framing']);
  assert.deepEqual(
    [...EXPECTED_ACTIONS],
    ['answer', 'diagnose', 'repair', 'direct-repair', 'rediagnose', 'record-resolution'],
  );
  assert.deepEqual([...EXPECTED_FORMATS], ['default', 'machine']);
});

test('golden schema v2: a minimal valid turns case is valid for every action', () => {
  for (const action of EXPECTED_ACTIONS) {
    const result = validateGoldenCase(turnsCase([userTurn(action), assistantTurn()]));
    assert.deepEqual(result.errors, [], `action "${action}": ${result.errors.join('; ')}`);
    assert.equal(result.valid, true, `action "${action}" should be valid`);
  }
});

test('golden schema v2: exactly one of prompt/turns is required — both present is invalid', () => {
  const result = validateGoldenCase(turnsCase([userTurn('answer'), assistantTurn()], { prompt: 'also has a prompt' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('prompt') && e.includes('turns')));
});

test('golden schema v2: exactly one of prompt/turns is required — neither present is invalid', () => {
  const bad = turnsCase([userTurn('answer'), assistantTurn()]);
  delete (bad as Record<string, unknown>).turns;
  const result = validateGoldenCase(bad);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('prompt') && e.includes('turns')));
});

test('golden schema v2: turns-only categories reject a prompt-shaped case', () => {
  const result = validateGoldenCase(withCase({ category: 'comprehension-gate' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('comprehension-gate')));
});

test('golden schema v2: prompt-only (M1) categories reject a turns-shaped case', () => {
  const result = validateGoldenCase(turnsCase([userTurn('answer'), assistantTurn()], { category: 'persona-baseline' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('persona-baseline')));
});

test('golden schema v2: pair_id is forbidden when turns is present', () => {
  const result = validateGoldenCase(turnsCase([userTurn('answer'), assistantTurn()], { pair_id: 'pair-x' }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('pair_id')));
});

test('golden schema v2: turns must have between 2 and 8 entries', () => {
  assert.equal(validateGoldenCase(turnsCase([])).valid, false);
  assert.equal(validateGoldenCase(turnsCase([userTurn('answer')])).valid, false);

  const eightTurns: unknown[] = [];
  for (let i = 0; i < 4; i += 1) {
    eightTurns.push(userTurn('answer'), assistantTurn());
  }
  assert.equal(validateGoldenCase(turnsCase(eightTurns)).valid, true);

  const nineTurns = [...eightTurns, userTurn('answer')];
  assert.equal(validateGoldenCase(turnsCase(nineTurns)).valid, false);
});

test('golden schema v2: turns must have an even count', () => {
  const three = [userTurn('answer'), assistantTurn(), userTurn('answer')];
  const result = validateGoldenCase(turnsCase(three));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('even')));
});

test('golden schema v2: turns must start with user and end with assistant', () => {
  const startsAssistant = validateGoldenCase(turnsCase([assistantTurn(), userTurn('answer')]));
  assert.equal(startsAssistant.valid, false);
  assert.ok(startsAssistant.errors.some((e) => e.includes('role')));

  // Even count (4), but the last turn is a user turn instead of assistant.
  const endsUser = validateGoldenCase(
    turnsCase([
      userTurn('answer'),
      assistantTurn(),
      userTurn('diagnose', { expected_candidate_count: 2 }),
      userTurn('rediagnose', { expected_candidate_count: 2 }),
    ]),
  );
  assert.equal(endsUser.valid, false);
  assert.ok(endsUser.errors.some((e) => e.includes('role')));
});

test('golden schema v2: turns must strictly alternate — two user turns in a row is invalid', () => {
  const result = validateGoldenCase(
    turnsCase([userTurn('answer'), userTurn('answer'), assistantTurn(), assistantTurn()]),
  );
  assert.equal(result.valid, false);
});

test('golden schema v2: all expectation fields are forbidden on assistant turns', () => {
  for (const field of [
    'expected_action',
    'expected_gap_type',
    'expected_question_count',
    'expected_candidate_count',
    'expected_known_gaps',
    'expected_format',
  ]) {
    const badAssistant = assistantTurn({ [field]: field === 'expected_action' ? 'answer' : 0 });
    const result = validateGoldenCase(turnsCase([userTurn('answer'), badAssistant]));
    assert.equal(result.valid, false, `assistant turn setting "${field}" should be invalid`);
    assert.ok(result.errors.some((e) => e.includes(field)));
  }
});

test('golden schema v2: an unknown field on a turn is invalid', () => {
  const result = validateGoldenCase(
    turnsCase([userTurn('answer', { unexpected_field: 'nope' }), assistantTurn()]),
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('unexpected_field')));
});

// --- action matrix (M2 §3.2) ---------------------------------------------

test('golden schema v2: expected_question_count must exactly match the action matrix', () => {
  const answerWrong = validateGoldenCase(turnsCase([userTurn('answer', { expected_question_count: 1 }), assistantTurn()]));
  assert.equal(answerWrong.valid, false);
  assert.ok(answerWrong.errors.some((e) => e.includes('expected_question_count')));

  const diagnoseWrong = validateGoldenCase(turnsCase([userTurn('diagnose', { expected_question_count: 0 }), assistantTurn()]));
  assert.equal(diagnoseWrong.valid, false);
  assert.ok(diagnoseWrong.errors.some((e) => e.includes('expected_question_count')));

  const repairWrong = validateGoldenCase(turnsCase([userTurn('repair', { expected_question_count: 1 }), assistantTurn()]));
  assert.equal(repairWrong.valid, false);
  assert.ok(repairWrong.errors.some((e) => e.includes('expected_question_count')));
});

test('golden schema v2: expected_action, expected_format, and expected_question_count are required on every user turn', () => {
  for (const field of ['expected_action', 'expected_format', 'expected_question_count'] as const) {
    const missing = userTurn('answer');
    delete missing[field];
    const result = validateGoldenCase(turnsCase([missing, assistantTurn()]));
    assert.equal(result.valid, false, `missing "${field}" should be invalid`);
    assert.ok(result.errors.some((e) => e.includes(field)), `missing "${field}" should mention the field`);
  }
});

test('golden schema v2: expected_candidate_count is required (2-4) for diagnose/rediagnose, forbidden otherwise', () => {
  for (const action of ['diagnose', 'rediagnose'] as const) {
    const missing = userTurn(action);
    delete missing.expected_candidate_count;
    assert.equal(validateGoldenCase(turnsCase([missing, assistantTurn()])).valid, false, `${action} missing candidate count`);

    assert.equal(
      validateGoldenCase(turnsCase([userTurn(action, { expected_candidate_count: 1 }), assistantTurn()])).valid,
      false,
      `${action} candidate count below range`,
    );
    assert.equal(
      validateGoldenCase(turnsCase([userTurn(action, { expected_candidate_count: 5 }), assistantTurn()])).valid,
      false,
      `${action} candidate count above range`,
    );
    for (const count of [2, 3, 4]) {
      assert.equal(
        validateGoldenCase(turnsCase([userTurn(action, { expected_candidate_count: count }), assistantTurn()])).valid,
        true,
        `${action} candidate count ${count} should be valid`,
      );
    }
  }

  for (const action of ['answer', 'repair', 'direct-repair', 'record-resolution'] as const) {
    const result = validateGoldenCase(turnsCase([userTurn(action, { expected_candidate_count: 2 }), assistantTurn()]));
    assert.equal(result.valid, false, `${action} must forbid candidate count`);
  }
});

test('golden schema v2: expected_gap_type is required (closed taxonomy) for repair/direct-repair/record-resolution, forbidden otherwise', () => {
  for (const action of ['repair', 'direct-repair', 'record-resolution'] as const) {
    const missing = userTurn(action);
    delete missing.expected_gap_type;
    assert.equal(validateGoldenCase(turnsCase([missing, assistantTurn()])).valid, false, `${action} missing gap type`);

    assert.equal(
      validateGoldenCase(turnsCase([userTurn(action, { expected_gap_type: 'vibes' }), assistantTurn()])).valid,
      false,
      `${action} unknown gap type`,
    );

    for (const type of GAP_TYPES) {
      assert.equal(
        validateGoldenCase(turnsCase([userTurn(action, { expected_gap_type: type }), assistantTurn()])).valid,
        true,
        `${action} gap type "${type}" should be valid`,
      );
    }
  }

  for (const action of ['answer', 'diagnose', 'rediagnose'] as const) {
    const result = validateGoldenCase(turnsCase([userTurn(action, { expected_gap_type: 'term' }), assistantTurn()]));
    assert.equal(result.valid, false, `${action} must forbid gap type`);
  }
});

test('golden schema v2: expected_known_gaps is required for record-resolution, optional elsewhere', () => {
  const missing = userTurn('record-resolution');
  delete missing.expected_known_gaps;
  assert.equal(validateGoldenCase(turnsCase([missing, assistantTurn()])).valid, false);

  assert.equal(
    validateGoldenCase(turnsCase([userTurn('record-resolution', { expected_known_gaps: [] }), assistantTurn()])).valid,
    true,
  );

  assert.equal(
    validateGoldenCase(turnsCase([userTurn('answer', { expected_known_gaps: [{ type: 'term', confidence: 0.5 }] }), assistantTurn()]))
      .valid,
    true,
  );
});

test('golden schema v2: expected_known_gaps confidence must be finite, in [0,1], and a quarter step', () => {
  const validConfidences = [0, 0.25, 0.5, 0.75, 1];
  for (const confidence of validConfidences) {
    const result = validateGoldenCase(
      turnsCase([userTurn('answer', { expected_known_gaps: [{ type: 'term', confidence }] }), assistantTurn()]),
    );
    assert.equal(result.valid, true, `confidence ${confidence} should be valid`);
  }

  const invalidConfidences = [-0.25, 1.25, 0.1, 0.3, NaN, Infinity, -Infinity];
  for (const confidence of invalidConfidences) {
    const result = validateGoldenCase(
      turnsCase([userTurn('answer', { expected_known_gaps: [{ type: 'term', confidence }] }), assistantTurn()]),
    );
    assert.equal(result.valid, false, `confidence ${confidence} should be invalid`);
  }
});

test('golden schema v2: expected_known_gaps rejects duplicate types and requires sorted (taxonomy) order', () => {
  const duplicate = validateGoldenCase(
    turnsCase([
      userTurn('answer', {
        expected_known_gaps: [
          { type: 'term', confidence: 0.5 },
          { type: 'term', confidence: 0.75 },
        ],
      }),
      assistantTurn(),
    ]),
  );
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.errors.some((e) => e.includes('duplicate')));

  const outOfOrder = validateGoldenCase(
    turnsCase([
      userTurn('answer', {
        expected_known_gaps: [
          { type: 'step', confidence: 0.5 },
          { type: 'term', confidence: 0.5 },
        ],
      }),
      assistantTurn(),
    ]),
  );
  assert.equal(outOfOrder.valid, false);
  assert.ok(outOfOrder.errors.some((e) => e.includes('sorted')));

  const sorted = validateGoldenCase(
    turnsCase([
      userTurn('answer', {
        expected_known_gaps: [
          { type: 'term', confidence: 0.5 },
          { type: 'step', confidence: 0.5 },
          { type: 'assumption', confidence: 0.5 },
          { type: 'framing', confidence: 0.5 },
        ],
      }),
      assistantTurn(),
    ]),
  );
  assert.deepEqual(sorted.errors, []);
  assert.equal(sorted.valid, true);
});

test('golden schema v2: expected_known_gaps entries reject unknown fields and unknown types', () => {
  const unknownField = validateGoldenCase(
    turnsCase([
      userTurn('answer', { expected_known_gaps: [{ type: 'term', confidence: 0.5, extra: 1 }] }),
      assistantTurn(),
    ]),
  );
  assert.equal(unknownField.valid, false);

  const unknownType = validateGoldenCase(
    turnsCase([
      userTurn('answer', { expected_known_gaps: [{ type: 'vibes', confidence: 0.5 }] }),
      assistantTurn(),
    ]),
  );
  assert.equal(unknownType.valid, false);
});

test('golden schema v2: v1 prompt-shaped cases remain valid and untouched by the turns rules', () => {
  const result = validateGoldenCase(VALID_CASE);
  assert.deepEqual(result, { valid: true, errors: [] });
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
