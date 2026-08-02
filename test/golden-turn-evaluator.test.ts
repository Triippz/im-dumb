import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluateGoldenTurns } from '../src/golden-turn-evaluator.ts';
import { TURNS_ONLY_CATEGORIES, type ExpectedAction, type GoldenCase } from '../src/golden-schema.ts';
import { DEFAULT_PROFILE } from '../src/profile.ts';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const casesDir = path.join(repoRoot, 'eval', 'golden', 'cases');
const gateActions = new Set<ExpectedAction>(['diagnose', 'rediagnose', 'repair', 'direct-repair']);
const EXPECTED_M2_PAIR_COUNT = 54;

function m2Cases(): GoldenCase[] {
  return readdirSync(casesDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(path.join(casesDir, name), 'utf8')) as GoldenCase)
    .filter((item) => (TURNS_ONLY_CATEGORIES as readonly string[]).includes(item.category));
}

// Hand-authored post-learn observations. These are deliberately independent
// of expected_known_gaps metadata so fixture expectations cannot prove themselves.
const RECORD_RESOLUTION_ACTUALS: Readonly<Record<string, Readonly<Record<number, unknown>>>> = {
  'profile-adaptation-cas-conflict': {
    2: [{ type: 'term', confidence: 0.75 }],
  },
  'profile-adaptation-selection-and-resolution': {
    3: [{ type: 'term', confidence: 0.5 }],
  },
  'profile-adaptation-success-reset': {
    2: [{ type: 'term', confidence: 1 }],
  },
  'profile-adaptation-second-failure-after-direct': {
    3: [{ type: 'step', confidence: 0.5 }, { type: 'framing', confidence: 0.75 }],
  },
};

function actualStatesFor(goldenCase: GoldenCase): Readonly<Record<number, unknown>> | undefined {
  const observations = RECORD_RESOLUTION_ACTUALS[goldenCase.id];
  return observations === undefined ? undefined : structuredClone(observations);
}

function diagnosis(count = 2): string {
  return [
    '**Likely confusion points**',
    ...Array.from({ length: count }, (_, index) => `- **Specific ${index + 1}**: Concrete description ${index + 1}.`),
    'Which specific point should I unpack?',
  ].join('\n');
}

function machineDiagnosis(count = 2): string {
  return JSON.stringify({
    candidates: Array.from({ length: count }, (_, index) => ({
      label: `Specific ${index + 1}`,
      description: `Concrete description ${index + 1}.`,
    })),
    question: 'Which specific point should I unpack?',
  });
}

function actionFields(action: ExpectedAction, format: 'default' | 'machine' = 'default'): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    expected_action: action,
    expected_question_count: action === 'diagnose' || action === 'rediagnose' ? 1 : 0,
    expected_format: format,
  };
  if (action === 'diagnose' || action === 'rediagnose') fields.expected_candidate_count = 2;
  if (action === 'repair' || action === 'direct-repair' || action === 'record-resolution') fields.expected_gap_type = 'term';
  if (action === 'record-resolution') fields.expected_known_gaps = [{ type: 'term', confidence: 0.5 }];
  return fields;
}

function onePair(
  action: ExpectedAction,
  assistant: string,
  options: {
    format?: 'default' | 'machine';
    checks?: Array<{ checker: string; expect: string }>;
    profile?: Record<string, unknown>;
    user?: Record<string, unknown>;
  } = {},
): unknown {
  return {
    id: `evaluator-${action}`,
    category: 'comprehension-gate',
    turns: [
      { role: 'user', content: 'captured user content', ...actionFields(action, options.format), ...options.user },
      { role: 'assistant', content: assistant },
    ],
    profile: options.profile ?? {},
    reference_facts: [],
    must_preserve: [],
    expected_checks: options.checks ?? [{ checker: 'sentence-cap', expect: 'pass' }],
  };
}

test('golden-turn evaluator: every committed M2 case passes with independent post-state observations', () => {
  for (const goldenCase of m2Cases()) {
    const before = structuredClone(goldenCase);
    const report = evaluateGoldenTurns(goldenCase, { actualKnownGapsByPair: actualStatesFor(goldenCase) });
    assert.equal(report.valid, true, goldenCase.id);
    assert.equal(report.pass, true, `${goldenCase.id}: ${report.errors.join('; ')}`);
    assert.deepEqual(goldenCase, before, `${goldenCase.id} must not be mutated`);
  }
});

test('golden-turn evaluator: dataset pairs and every declared expectation dispatch exactly once', () => {
  const cases = m2Cases();
  const expectedPairCount = cases.reduce((total, item) => total + item.turns!.length / 2, 0);
  let actualPairCount = 0;
  for (const goldenCase of cases) {
    const report = evaluateGoldenTurns(goldenCase, { actualKnownGapsByPair: actualStatesFor(goldenCase) });
    actualPairCount += report.pairs.length;
    for (const pair of report.pairs) {
      assert.equal(pair.userIndex, pair.pairIndex * 2);
      assert.equal(pair.assistantIndex, pair.userIndex + 1);
      for (const expected of goldenCase.expected_checks) {
        assert.equal(pair.expectationDispatchCounts[expected.checker], 1, `${goldenCase.id} pair ${pair.pairIndex}`);
        const invoked = pair.invocationCounts[expected.checker] ?? 0;
        const exempt = pair.exemptionCounts[expected.checker] ?? 0;
        assert.equal(invoked + exempt, 1, `${goldenCase.id} pair ${pair.pairIndex} ${expected.checker}`);
      }
      const action = goldenCase.turns![pair.userIndex]!.expected_action!;
      assert.equal(pair.invocationCounts['comprehension-gate'] ?? 0, gateActions.has(action) ? 1 : 0);
    }
  }
  assert.equal(expectedPairCount, EXPECTED_M2_PAIR_COUNT);
  assert.equal(actualPairCount, EXPECTED_M2_PAIR_COUNT);
});

test('golden-turn evaluator: all actions and both gate formats dispatch their required checks', () => {
  const examples: Array<[ExpectedAction, 'default' | 'machine', string]> = [
    ['answer', 'default', 'A captured answer.'],
    ['diagnose', 'default', diagnosis()],
    ['diagnose', 'machine', machineDiagnosis()],
    ['rediagnose', 'default', diagnosis()],
    ['rediagnose', 'machine', machineDiagnosis()],
    ['repair', 'default', 'A direct repair.'],
    ['repair', 'machine', 'A direct repair.'],
    ['direct-repair', 'default', 'A direct repair.'],
    ['direct-repair', 'machine', 'A direct repair.'],
    ['record-resolution', 'default', 'Resolution recorded.'],
    ['record-resolution', 'machine', 'Resolution recorded.'],
  ];
  for (const [action, format, content] of examples) {
    const observations = action === 'record-resolution' ? { 0: [{ type: 'term', confidence: 0.5 }] } : {};
    const report = evaluateGoldenTurns(onePair(action, content, { format }), { actualKnownGapsByPair: observations });
    assert.equal(report.pass, true, `${action}/${format}: ${report.errors.join('; ')}`);
    assert.equal(report.invocationCounts['comprehension-gate'] ?? 0, gateActions.has(action) ? 1 : 0);
  }
});

test('golden-turn evaluator: prose pass, fail, and warn expectations use exact severity semantics', () => {
  const pass = evaluateGoldenTurns(onePair('answer', 'Short answer.', {
    checks: [{ checker: 'sentence-cap', expect: 'pass' }],
  }));
  assert.equal(pass.pass, true);

  const fail = evaluateGoldenTurns(onePair('answer', 'This sentence deliberately contains far more than twenty separate words so the sentence cap checker emits a deterministic error for this captured assistant response.', {
    checks: [{ checker: 'sentence-cap', expect: 'fail' }],
  }));
  assert.equal(fail.pass, true);
  assert.ok(fail.pairs[0]!.checks[0]!.violations.some((item) => item.severity === 'error'));

  const warn = evaluateGoldenTurns(onePair('answer', '- one\n- two\n- three\n- four', {
    profile: { adhd_mode: true },
    checks: [{ checker: 'adhd-structure', expect: 'warn' }],
  }));
  assert.equal(warn.pass, true, warn.errors.join('; '));
  assert.ok(warn.pairs[0]!.checks[0]!.violations.some((item) => item.severity === 'warn'));

  const wrongSeverity = evaluateGoldenTurns(onePair('answer', 'Basically, this is an error.', {
    profile: { adhd_mode: true },
    checks: [{ checker: 'forbidden-phrases', expect: 'warn' }],
  }));
  assert.equal(wrongSeverity.pass, false);
});

test('golden-turn evaluator: profile overrides merge with frozen defaults without mutation', () => {
  const before = structuredClone(DEFAULT_PROFILE);
  const input = onePair('answer', 'Custom blocked phrase.', {
    profile: { forbidden_phrases: ['custom blocked'] },
    checks: [{ checker: 'forbidden-phrases', expect: 'fail' }],
  });
  assert.equal(evaluateGoldenTurns(input).pass, true);
  assert.deepEqual(DEFAULT_PROFILE, before);
});

test('golden-turn evaluator: gate checker errors are preserved exactly and it is never invoked twice when declared', () => {
  const report = evaluateGoldenTurns(onePair('diagnose', 'not a diagnosis', {
    checks: [{ checker: 'comprehension-gate', expect: 'fail' }],
  }));
  assert.equal(report.pass, true);
  assert.equal(report.invocationCounts['comprehension-gate'], 1);
  const gate = report.pairs[0]!.checks.find((check) => check.checker === 'comprehension-gate')!;
  assert.equal(gate.status, 'invoked');
  assert.ok(gate.violations.length > 0);
  assert.ok(gate.violations.every((item) => item.checker === 'comprehension-gate' && item.severity === 'error'));
});

test('golden-turn evaluator: undeclared gate violations fail a pair', () => {
  const report = evaluateGoldenTurns(onePair('diagnose', 'not a diagnosis'));
  assert.equal(report.pass, false);
  assert.equal(report.invocationCounts['comprehension-gate'], 1);
  assert.ok(report.errors.some((error) => /heading|candidate|question/.test(error)));
});

test('golden-turn evaluator: a declared gate checker is exempt on non-gate pairs and reused on gate pairs', () => {
  const goldenCase = {
    id: 'mixed-gate-declaration',
    category: 'comprehension-gate',
    turns: [
      { role: 'user', content: 'Explain it.', ...actionFields('answer') },
      { role: 'assistant', content: 'A short answer.' },
      { role: 'user', content: 'huh', ...actionFields('diagnose') },
      { role: 'assistant', content: diagnosis() },
    ],
    profile: {},
    reference_facts: [],
    must_preserve: [],
    expected_checks: [{ checker: 'comprehension-gate', expect: 'pass' }],
  };
  const report = evaluateGoldenTurns(goldenCase);
  assert.equal(report.pass, true, report.errors.join('; '));
  assert.equal(report.pairs[0]!.checks[0]!.status, 'exempt');
  assert.equal(report.pairs[0]!.exemptionCounts['comprehension-gate'], 1);
  assert.equal(report.pairs[0]!.invocationCounts['comprehension-gate'] ?? 0, 0);
  assert.equal(report.pairs[1]!.checks[0]!.status, 'invoked');
  assert.equal(report.pairs[1]!.invocationCounts['comprehension-gate'], 1);
  assert.equal(report.invocationCounts['comprehension-gate'], 1);
  assert.equal(report.exemptionCounts['comprehension-gate'], 1);
});

test('golden-turn evaluator: output shape and ADHD structure are exempt for gate actions or machine format only', () => {
  const checks = [
    { checker: 'output-shape', expect: 'pass' },
    { checker: 'adhd-structure', expect: 'pass' },
  ];
  for (const action of ['diagnose', 'rediagnose', 'repair', 'direct-repair'] as const) {
    const content = action === 'diagnose' || action === 'rediagnose' ? diagnosis() : 'Repair text.';
    const report = evaluateGoldenTurns(onePair(action, content, { checks, profile: { adhd_mode: true } }));
    assert.equal(report.pass, true, report.errors.join('; '));
    assert.deepEqual(report.pairs[0]!.checks.slice(0, 2).map((check) => check.status), ['exempt', 'exempt']);
    assert.equal(report.pairs[0]!.invocationCounts['output-shape'] ?? 0, 0);
    assert.equal(report.pairs[0]!.exemptionCounts['output-shape'], 1);
  }

  const answer = evaluateGoldenTurns(onePair('answer', 'Simple answer.', { checks, profile: { adhd_mode: true } }));
  assert.equal(answer.pairs[0]!.invocationCounts['output-shape'], 1);
  assert.equal(answer.pairs[0]!.invocationCounts['adhd-structure'], 1);
  const resolution = evaluateGoldenTurns(onePair('record-resolution', 'Done.', { checks }), {
    actualKnownGapsByPair: { 0: [{ type: 'term', confidence: 0.5 }] },
  });
  assert.equal(resolution.pairs[0]!.invocationCounts['output-shape'], 1);
  assert.equal(resolution.pairs[0]!.invocationCounts['adhd-structure'], 1);

  for (const action of ['answer', 'record-resolution'] as const) {
    const report = evaluateGoldenTurns(onePair(action, '{}', { checks, format: 'machine' }), {
      actualKnownGapsByPair: action === 'record-resolution' ? { 0: [{ type: 'term', confidence: 0.5 }] } : undefined,
    });
    assert.equal(report.pairs[0]!.invocationCounts['output-shape'] ?? 0, 0);
    assert.equal(report.pairs[0]!.exemptionCounts['output-shape'], 1);
    assert.equal(report.pairs[0]!.exemptionCounts['adhd-structure'], 1);
  }
});

test('golden-turn evaluator: non-gate question count uses fenced, inline, and blockquote exclusions', () => {
  const excluded = ['Plain answer.', '`inline?`', '```', 'fenced?', '```', '> quoted?'].join('\n');
  assert.equal(evaluateGoldenTurns(onePair('answer', excluded)).pass, true);
  const visible = evaluateGoldenTurns(onePair('answer', `${excluded}\nVisible?`));
  assert.equal(visible.pass, false);
  assert.ok(visible.errors.some((error) => error.includes('question-count expected 0, found 1')));
});

test('golden-turn evaluator: actual state starts from profile, updates from observations, and carries forward', () => {
  const successReset = m2Cases().find((item) => item.id === 'profile-adaptation-success-reset')!;
  const committed = evaluateGoldenTurns(successReset, {
    actualKnownGapsByPair: actualStatesFor(successReset),
  });
  assert.equal(committed.pass, true, committed.errors.join('; '));
  assert.equal(committed.pairs[1]!.checks.find((check) => check.checker === 'known-gaps')!.pass, true);
  assert.equal(committed.pairs[2]!.checks.find((check) => check.checker === 'known-gaps')!.pass, true);
  assert.equal(committed.pairs[3]!.checks.find((check) => check.checker === 'known-gaps')!.pass, true);

  const overridden = {
    id: 'state-override-carries',
    category: 'profile-adaptation',
    turns: [
      { role: 'user', content: 'First.', ...actionFields('answer'), expected_known_gaps: [{ type: 'term', confidence: 0.5 }] },
      { role: 'assistant', content: 'First answer.' },
      { role: 'user', content: 'Second.', ...actionFields('answer'), expected_known_gaps: [{ type: 'term', confidence: 0.5 }] },
      { role: 'assistant', content: 'Second answer.' },
    ],
    profile: { known_gap_types: [{ type: 'term', confidence: 0.25 }] },
    reference_facts: [],
    must_preserve: [],
    expected_checks: [{ checker: 'sentence-cap', expect: 'pass' }],
  };
  const report = evaluateGoldenTurns(overridden, {
    actualKnownGapsByPair: { 0: [{ type: 'term', confidence: 0.5 }] },
  });
  assert.equal(report.pass, true, report.errors.join('; '));
});

test('golden-turn evaluator: independent actual state catches mutated expected metadata', () => {
  const original = m2Cases().find((item) => item.id === 'profile-adaptation-selection-and-resolution')!;
  const mutated = structuredClone(original);
  mutated.turns![6]!.expected_known_gaps = [{ type: 'term', confidence: 0.75 }];
  const report = evaluateGoldenTurns(mutated, { actualKnownGapsByPair: actualStatesFor(original) });
  assert.equal(report.valid, true);
  assert.equal(report.pass, false);
  assert.ok(report.errors.some((error) => error.includes('expected [{"type":"term","confidence":0.75}]')));
});

test('golden-turn evaluator: record-resolution snapshots handle missing, wrong, extra, duplicate, and unknown-only state', () => {
  const goldenCase = onePair('record-resolution', 'Recorded.');
  const snapshots: Array<[string, Record<number, unknown> | undefined, boolean]> = [
    ['missing', undefined, false],
    ['wrong', { 0: [{ type: 'term', confidence: 0.75 }] }, false],
    ['extra', { 0: [{ type: 'term', confidence: 0.5 }, { type: 'step', confidence: 0.25 }] }, false],
    ['duplicate', { 0: [{ type: 'term', confidence: 0.5 }, { type: 'term', confidence: 0.5 }] }, false],
    ['unknown-only', { 0: [{ type: 'future-gap', confidence: 0.5 }] }, false],
    ['unknown-plus-exact', { 0: [{ type: 'future-gap', confidence: 0.5 }, { type: 'term', confidence: 0.5 }] }, true],
  ];
  for (const [name, actualKnownGapsByPair, expectedPass] of snapshots) {
    const report = evaluateGoldenTurns(goldenCase, { actualKnownGapsByPair });
    assert.equal(report.pass, expectedPass, `${name}: ${report.errors.join('; ')}`);
  }
});

test('golden-turn evaluator: every actual entry is validated before valid unknown types become inert', () => {
  const goldenCase = onePair('answer', 'Answer.', { user: { expected_known_gaps: [] } });
  const invalidEntries: unknown[] = [
    null,
    1,
    {},
    { type: 'term' },
    { confidence: 0.5 },
    { type: 'term', confidence: 0.5, extra: true },
    Object.assign(Object.create({ inherited: true }), { type: 'future', confidence: 0.5 }),
    { type: '', confidence: 0.5 },
    { type: 'x'.repeat(41), confidence: 0.5 },
    { type: 'future\nkind', confidence: 0.5 },
    { type: 'future', confidence: NaN },
    { type: 'future', confidence: Infinity },
    { type: 'future', confidence: -0.1 },
    { type: 'future', confidence: 1.1 },
    { type: 'future', confidence: '0.5' },
  ];
  for (const entry of invalidEntries) {
    const report = evaluateGoldenTurns(goldenCase, { actualKnownGapsByPair: { 0: [entry] } });
    assert.equal(report.pass, false, JSON.stringify(entry));
    assert.equal(report.valid, true);
    assert.deepEqual(report.pairs, []);
  }
  assert.equal(evaluateGoldenTurns(goldenCase, {
    actualKnownGapsByPair: { 0: [{ type: 'future', confidence: 0.5 }] },
  }).pass, true);
});

test('golden-turn evaluator: orphan observation keys fail before dispatch without invalidating the case schema', () => {
  const withExpectation = onePair('answer', 'Answer.', { user: { expected_known_gaps: [] } });
  const withoutExpectation = onePair('answer', 'Answer.');
  const options: Array<[unknown, unknown]> = [
    [withExpectation, { '-1': [] }],
    [withExpectation, { '0.5': [] }],
    [withExpectation, { 1: [] }],
    [withoutExpectation, { 0: [] }],
  ];
  for (const [goldenCase, actualKnownGapsByPair] of options) {
    const report = evaluateGoldenTurns(goldenCase, {
      actualKnownGapsByPair: actualKnownGapsByPair as Record<number, unknown>,
    });
    assert.equal(report.valid, true);
    assert.equal(report.pass, false);
    assert.deepEqual(report.pairs, []);
    assert.deepEqual(report.invocationCounts, {});
  }
});

test('golden-turn evaluator: prompt-only and malformed/orphan cases fail before any dispatch', () => {
  const promptOnly = {
    id: 'prompt-only', category: 'persona-baseline', prompt: 'Prompt', profile: {},
    reference_facts: [], must_preserve: [], expected_checks: [{ checker: 'sentence-cap', expect: 'pass' }],
  };
  const orphan = onePair('answer', 'Answer.') as Record<string, unknown>;
  (orphan.turns as unknown[]).pop();
  for (const input of [promptOnly, orphan, null, { ...promptOnly, prompt: undefined }]) {
    const report = evaluateGoldenTurns(input);
    assert.equal(report.valid, false);
    assert.equal(report.pass, false);
    assert.deepEqual(report.pairs, []);
    assert.deepEqual(report.invocationCounts, {});
  }
});

test('golden-turn evaluator: unsupported structural declarations and duplicate declarations are explicit failures', () => {
  const unsupported = evaluateGoldenTurns(onePair('answer', 'Answer.', {
    checks: [{ checker: 'frontmatter', expect: 'pass' }],
  }));
  assert.equal(unsupported.valid, true);
  assert.equal(unsupported.pass, false);
  assert.equal(unsupported.pairs[0]!.checks[0]!.status, 'unsupported');
  assert.ok(unsupported.errors.some((error) => error.includes('not supported for turns')));

  const duplicate = evaluateGoldenTurns(onePair('answer', 'Answer.', {
    checks: [
      { checker: 'sentence-cap', expect: 'pass' },
      { checker: 'sentence-cap', expect: 'pass' },
    ],
  }));
  assert.equal(duplicate.valid, false);
  assert.deepEqual(duplicate.pairs, []);
  assert.ok(duplicate.errors.some((error) => error.includes('duplicate expected checker')));
});

test('golden-turn evaluator: deleting or adding metadata cannot mutate or generate captured assistant content', () => {
  const original = onePair('answer', 'Captured response stays byte-for-byte identical.', {
    user: { expected_known_gaps: [] },
  }) as GoldenCase;
  const deletedMetadata = structuredClone(original) as unknown as Record<string, unknown>;
  delete (deletedMetadata.turns as Array<Record<string, unknown>>)[0]!.expected_known_gaps;
  const addedMetadata = structuredClone(deletedMetadata) as unknown as Record<string, unknown>;
  (addedMetadata.turns as Array<Record<string, unknown>>)[0]!.expected_known_gaps = [{ type: 'term', confidence: 0.5 }];

  const captured = original.turns![1]!.content;
  evaluateGoldenTurns(deletedMetadata);
  evaluateGoldenTurns(addedMetadata, { actualKnownGapsByPair: { 0: [{ type: 'term', confidence: 0.5 }] } });
  assert.equal((deletedMetadata.turns as Array<Record<string, unknown>>)[1]!.content, captured);
  assert.equal((addedMetadata.turns as Array<Record<string, unknown>>)[1]!.content, captured);
  assert.equal(original.turns![1]!.content, captured);
});

test('golden-turn evaluator: checker paths return reports and never throw', () => {
  const cases = [
    onePair('diagnose', '{bad json', { format: 'machine' }),
    onePair('answer', 'Basically, a very long captured response with many words that intentionally exercises several deterministic checker branches.', {
      profile: { adhd_mode: true, forbidden_phrases: ['captured response'] },
      checks: [
        { checker: 'sentence-cap', expect: 'pass' },
        { checker: 'forbidden-phrases', expect: 'pass' },
        { checker: 'one-term-one-concept', expect: 'pass' },
        { checker: 'output-shape', expect: 'pass' },
        { checker: 'adhd-structure', expect: 'pass' },
      ],
    }),
  ];
  for (const goldenCase of cases) assert.doesNotThrow(() => evaluateGoldenTurns(goldenCase));
  const allProse = evaluateGoldenTurns(cases[1]);
  for (const checker of ['sentence-cap', 'forbidden-phrases', 'one-term-one-concept', 'output-shape', 'adhd-structure']) {
    assert.equal(allProse.pairs[0]!.invocationCounts[checker], 1);
  }
});
