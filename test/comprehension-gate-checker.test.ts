import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkComprehensionGate,
  COMPREHENSION_GATE_CHECKER_VERSION,
  GENERIC_LABEL_DENY_SET,
  BARE_REASK_DENY_SET,
  DIAGNOSIS_HEADING,
  type ComprehensionGateCheckOptions,
} from '../src/comprehension-gate-checker.ts';
import { CHECKER_IDS } from '../src/checkers.ts';

function opts(overrides: Partial<ComprehensionGateCheckOptions> = {}): ComprehensionGateCheckOptions {
  return { action: 'diagnose', format: 'default', ...overrides };
}

/** A fully compliant default-format diagnosis with 3 candidates. */
function goodDiagnosis(): string {
  return [
    '**Likely confusion points**',
    "- **API rate limit**: the specific request cap you're hitting",
    '- **auth token scope**: whether the token covers this endpoint',
    '- **retry backoff**: how long to wait before retrying',
    'Which of these matches what tripped you up?',
  ].join('\n');
}

function goodMachineDiagnosis(): string {
  return JSON.stringify({
    candidates: [
      { label: 'API rate limit', description: "the specific request cap you're hitting" },
      { label: 'auth token scope', description: 'whether the token covers this endpoint' },
    ],
    question: 'Which of these matches what tripped you up?',
  });
}

// ---------------------------------------------------------------------------
// checker registry (task: add comprehension-gate to CHECKER_IDS)
// ---------------------------------------------------------------------------

test('CHECKER_IDS includes versioned comprehension-gate', () => {
  assert.ok((CHECKER_IDS as readonly string[]).includes('comprehension-gate'));
  assert.equal(COMPREHENSION_GATE_CHECKER_VERSION, 'm2-v1');
});

// ---------------------------------------------------------------------------
// Frozen deny sets, exact contract
// ---------------------------------------------------------------------------

test('frozen generic-label deny set is exactly the three specified labels', () => {
  assert.deepEqual([...GENERIC_LABEL_DENY_SET].sort(), ['not sure', 'other', 'something'].sort());
});

test('frozen bare-re-ask deny set is exactly the four specified phrases', () => {
  assert.deepEqual(
    [...BARE_REASK_DENY_SET].sort(),
    ["what didn't you understand?", 'what part was confusing?', 'can you clarify?', 'can you be more specific?'].sort(),
  );
});

test('DIAGNOSIS_HEADING is the exact frozen heading line', () => {
  assert.equal(DIAGNOSIS_HEADING, '**Likely confusion points**');
});

// ---------------------------------------------------------------------------
// Golden path, default format diagnose/rediagnose
// ---------------------------------------------------------------------------

test('checkComprehensionGate: compliant default diagnosis (3 candidates) has zero violations', () => {
  assert.deepEqual(checkComprehensionGate(goodDiagnosis(), opts()), []);
});

test('checkComprehensionGate: compliant default rediagnosis (2 candidates) has zero violations', () => {
  const text = [
    '**Likely confusion points**',
    '- **cache invalidation**: when the stale entry actually gets evicted',
    '- **event ordering**: whether handlers run before or after the write',
    'Does either of these match the part that confused you?',
  ].join('\n');
  assert.deepEqual(checkComprehensionGate(text, opts({ action: 'rediagnose' })), []);
});

test('checkComprehensionGate: 4 candidates (the max) is compliant', () => {
  const text = [
    '**Likely confusion points**',
    '- **term one**: description one',
    '- **term two**: description two',
    '- **term three**: description three',
    '- **term four**: description four',
    'Which one is it?',
  ].join('\n');
  assert.deepEqual(checkComprehensionGate(text, opts()), []);
});

test('checkComprehensionGate: exact candidate count matches expectedCandidateCount is compliant', () => {
  assert.deepEqual(checkComprehensionGate(goodDiagnosis(), opts({ expectedCandidateCount: 3 })), []);
});

// ---------------------------------------------------------------------------
// Heading clause
// ---------------------------------------------------------------------------

test('checkComprehensionGate: missing heading is a violation', () => {
  const text = goodDiagnosis().replace('**Likely confusion points**\n', '');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /heading/i.test(v.message)));
});

test('checkComprehensionGate: heading with wrong text is a violation', () => {
  const text = goodDiagnosis().replace('**Likely confusion points**', '**Possible confusion points**');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /heading/i.test(v.message)));
});

test('checkComprehensionGate: heading with different casing is a violation (exact match required)', () => {
  const text = goodDiagnosis().replace('**Likely confusion points**', '**likely confusion points**');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /heading/i.test(v.message)));
});

test('checkComprehensionGate: heading not the first line is a violation (misorder)', () => {
  const text = ['Here is some intro text.', ...goodDiagnosis().split('\n')].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /heading/i.test(v.message)));
});

// ---------------------------------------------------------------------------
// Candidate bullet block clause
// ---------------------------------------------------------------------------

test('checkComprehensionGate: only 1 candidate bullet is a violation (below minimum of 2)', () => {
  const text = ['**Likely confusion points**', '- **term one**: description one', 'What is it?'].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /2-4|candidate/i.test(v.message)));
});

test('checkComprehensionGate: 5 candidate bullets is a violation (above maximum of 4)', () => {
  const text = [
    '**Likely confusion points**',
    '- **term one**: description one',
    '- **term two**: description two',
    '- **term three**: description three',
    '- **term four**: description four',
    '- **term five**: description five',
    'Which one is it?',
  ].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /2-4|candidate/i.test(v.message)));
});

test('checkComprehensionGate: zero candidate bullets is a violation', () => {
  const text = ['**Likely confusion points**', 'What is it?'].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /2-4|candidate/i.test(v.message)));
});

test('checkComprehensionGate: bullet missing bold label markers is not recognized as a candidate bullet', () => {
  const text = ['**Likely confusion points**', '- term one: description one', '- term two: description two', 'Which one?'].join(
    '\n',
  );
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /2-4|candidate/i.test(v.message)));
});

test('checkComprehensionGate: bullet missing colon separator is not recognized as a candidate bullet', () => {
  const text = [
    '**Likely confusion points**',
    '- **term one** description one',
    '- **term two** description two',
    'Which one?',
  ].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /2-4|candidate/i.test(v.message)));
});

test('checkComprehensionGate: bullet missing the required space after its colon is rejected', () => {
  const text = [
    '**Likely confusion points**',
    '- **term one**:description one',
    '- **term two**: description two',
    'Which one?',
  ].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /2-4|candidate/i.test(v.message)));
});

test('checkComprehensionGate: bullet with empty label after trim is a violation', () => {
  const text = [
    '**Likely confusion points**',
    '- ** **: description one',
    '- **term two**: description two',
    'Which one?',
  ].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /label/i.test(v.message)));
});

test('checkComprehensionGate: bullet with empty description after trim is a violation', () => {
  const text = ['**Likely confusion points**', '- **term one**:   ', '- **term two**: description two', 'Which one?'].join(
    '\n',
  );
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /description/i.test(v.message)));
});

// ---------------------------------------------------------------------------
// Exact expected candidate count clause
// ---------------------------------------------------------------------------

test('checkComprehensionGate: candidate count mismatch against expectedCandidateCount is a violation', () => {
  const violations = checkComprehensionGate(goodDiagnosis(), opts({ expectedCandidateCount: 4 }));
  assert.ok(violations.some((v) => /expected exactly 4/i.test(v.message)));
});

// ---------------------------------------------------------------------------
// Generic-label deny set clause (normalized)
// ---------------------------------------------------------------------------

for (const generic of ['something', 'other', 'not sure']) {
  test(`checkComprehensionGate: generic label "${generic}" is deny-listed`, () => {
    const text = [
      '**Likely confusion points**',
      `- **${generic}**: some description`,
      '- **term two**: description two',
      'Which one?',
    ].join('\n');
    const violations = checkComprehensionGate(text, opts());
    assert.ok(violations.some((v) => /generic/i.test(v.message)));
  });
}

test('checkComprehensionGate: generic label deny set is normalized (case/whitespace/NFKC insensitive)', () => {
  const text = [
    '**Likely confusion points**',
    '- **  Something  **: some description',
    '- **term two**: description two',
    'Which one?',
  ].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /generic/i.test(v.message)));
});

test('checkComprehensionGate: a label that merely contains a deny-listed word as a substring is not deny-listed', () => {
  const text = [
    '**Likely confusion points**',
    '- **something specific**: some description',
    '- **term two**: description two',
    'Which one?',
  ].join('\n');
  assert.deepEqual(checkComprehensionGate(text, opts()), []);
});

// ---------------------------------------------------------------------------
// Final question-line clause
// ---------------------------------------------------------------------------

test('checkComprehensionGate: final line that is a list item is a violation', () => {
  const text = [
    '**Likely confusion points**',
    '- **term one**: description one',
    '- **term two**: description two',
    '- Which one is it?',
  ].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /list/i.test(v.message)));
});

test('checkComprehensionGate: final line not ending in "?" is a violation', () => {
  const text = [
    '**Likely confusion points**',
    '- **term one**: description one',
    '- **term two**: description two',
    'Let me know which one it was.',
  ].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /end with/i.test(v.message)));
});

test('checkComprehensionGate: missing final question line entirely is a violation', () => {
  const text = ['**Likely confusion points**', '- **term one**: description one', '- **term two**: description two'].join(
    '\n',
  );
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /final question/i.test(v.message)));
});

// ---------------------------------------------------------------------------
// Exactly-one-"?"-outside-exclusions clause
// ---------------------------------------------------------------------------

test('checkComprehensionGate: a second bare "?" in a bullet description is a violation', () => {
  const text = [
    '**Likely confusion points**',
    '- **term one**: is this the rate limit?',
    '- **term two**: description two',
    'Which one is it?',
  ].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /exactly one "\?"/i.test(v.message)));
});

test('checkComprehensionGate: a "?" inside inline code is excluded from the count', () => {
  const text = [
    '**Likely confusion points**',
    '- **term one**: the `foo?` flag behavior',
    '- **term two**: description two',
    'Which one is it?',
  ].join('\n');
  assert.deepEqual(checkComprehensionGate(text, opts()), []);
});

test('checkComprehensionGate: a "?" inside a fenced code block is excluded from the count', () => {
  const text = [
    '**Likely confusion points**',
    '- **term one**: see the snippet below',
    '- **term two**: description two',
    '```',
    'is this valid?',
    '```',
    'Which one is it?',
  ].join('\n');
  // The fenced block adds extra non-blank lines after the candidates, which
  // independently violates the "one final question line" structural clause,
  // but must NOT also trigger the "?"-count clause.
  const violations = checkComprehensionGate(text, opts());
  assert.ok(!violations.some((v) => /exactly one "\?"/i.test(v.message)));
});

test('checkComprehensionGate: a "?" inside a blockquote line is excluded from the count', () => {
  const text = [
    '**Likely confusion points**',
    '- **term one**: description one',
    '- **term two**: description two',
    '> is this valid?',
    'Which one is it?',
  ].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(!violations.some((v) => /exactly one "\?"/i.test(v.message)));
});

// ---------------------------------------------------------------------------
// Bare-re-ask deny set clause (normalized)
// ---------------------------------------------------------------------------

for (const bare of [
  "what didn't you understand?",
  'what part was confusing?',
  'can you clarify?',
  'can you be more specific?',
]) {
  test(`checkComprehensionGate: bare re-ask "${bare}" is a violation`, () => {
    const text = [
      '**Likely confusion points**',
      '- **term one**: description one',
      '- **term two**: description two',
      bare.charAt(0).toUpperCase() + bare.slice(1),
    ].join('\n');
    const violations = checkComprehensionGate(text, opts());
    assert.ok(violations.some((v) => /bare-re-ask|bare re-ask/i.test(v.message)));
  });
}

test('checkComprehensionGate: bare re-ask deny set is normalized (case/whitespace/NFKC insensitive)', () => {
  const text = [
    '**Likely confusion points**',
    '- **term one**: description one',
    '- **term two**: description two',
    '  CAN   YOU  CLARIFY?  ',
  ].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /bare-re-ask|bare re-ask/i.test(v.message)));
});

test('checkComprehensionGate: a specific question that merely contains "clarify" is not a bare re-ask', () => {
  const text = [
    '**Likely confusion points**',
    '- **term one**: description one',
    '- **term two**: description two',
    'Can you clarify whether it was the token or the limit?',
  ].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(!violations.some((v) => /bare-re-ask|bare re-ask/i.test(v.message)));
});

// ---------------------------------------------------------------------------
// Reject extras / misorder clause
// ---------------------------------------------------------------------------

test('checkComprehensionGate: stray line between candidates and question is a violation', () => {
  const text = [
    '**Likely confusion points**',
    '- **term one**: description one',
    '- **term two**: description two',
    'some stray unrelated line',
    'Which one is it?',
  ].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /final question/i.test(v.message)));
});

test('checkComprehensionGate: question before candidates (misorder) is a violation', () => {
  const text = [
    '**Likely confusion points**',
    'Which one is it?',
    '- **term one**: description one',
    '- **term two**: description two',
  ].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.length > 0);
});

test('checkComprehensionGate: trailing content after the question line is a violation', () => {
  const text = [
    '**Likely confusion points**',
    '- **term one**: description one',
    '- **term two**: description two',
    'Which one is it?',
    'Thanks in advance.',
  ].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /final question/i.test(v.message)));
});

test('checkComprehensionGate: blank lines break the frozen structure', () => {
  const text = [
    '**Likely confusion points**',
    '',
    '- **term one**: description one',
    '- **term two**: description two',
    '',
    'Which one is it?',
  ].join('\n');
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.some((v) => /directly below|final question/i.test(v.message)));
});

test('checkComprehensionGate: leading, trailing, and indented structural whitespace is rejected', () => {
  assert.ok(checkComprehensionGate(`\n${goodDiagnosis()}`, opts()).length > 0);
  assert.ok(checkComprehensionGate(`${goodDiagnosis()}\n`, opts()).length > 0);
  assert.ok(checkComprehensionGate(goodDiagnosis().replace(DIAGNOSIS_HEADING, ` ${DIAGNOSIS_HEADING}`), opts()).length > 0);
  assert.ok(checkComprehensionGate(goodDiagnosis().replace('- **API', ' - **API'), opts()).length > 0);
  assert.ok(checkComprehensionGate(goodDiagnosis().replace('Which of', ' Which of'), opts()).length > 0);
});

// ---------------------------------------------------------------------------
// output-shape and ADHD exemption is out of scope for this checker, no assertions needed
// here since this slice only implements the comprehension-gate checker.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Machine (exact JSON) format, diagnose/rediagnose
// ---------------------------------------------------------------------------

test('checkComprehensionGate: compliant machine-format diagnosis has zero violations', () => {
  assert.deepEqual(checkComprehensionGate(goodMachineDiagnosis(), opts({ format: 'machine' })), []);
});

test('checkComprehensionGate: malformed JSON never throws and reports a violation', () => {
  assert.doesNotThrow(() => {
    const violations = checkComprehensionGate('{ this is not json', opts({ format: 'machine' }));
    assert.ok(violations.length > 0);
  });
});

test('checkComprehensionGate: machine format non-object JSON (array) is a violation', () => {
  const violations = checkComprehensionGate('[]', opts({ format: 'machine' }));
  assert.ok(violations.some((v) => /object/i.test(v.message)));
});

test('checkComprehensionGate: machine format non-object JSON (string) is a violation', () => {
  const violations = checkComprehensionGate('"hello"', opts({ format: 'machine' }));
  assert.ok(violations.some((v) => /object/i.test(v.message)));
});

test('checkComprehensionGate: machine format non-object JSON (null) is a violation', () => {
  const violations = checkComprehensionGate('null', opts({ format: 'machine' }));
  assert.ok(violations.some((v) => /object/i.test(v.message)));
});

test('checkComprehensionGate: machine format with an extra top-level key is a violation', () => {
  const obj = JSON.parse(goodMachineDiagnosis());
  obj.extra = 'nope';
  const violations = checkComprehensionGate(JSON.stringify(obj), opts({ format: 'machine' }));
  assert.ok(violations.some((v) => /exactly.*keys|candidates.*question/i.test(v.message)));
});

test('checkComprehensionGate: machine format missing the question key is a violation', () => {
  const obj = JSON.parse(goodMachineDiagnosis());
  delete obj.question;
  const violations = checkComprehensionGate(JSON.stringify(obj), opts({ format: 'machine' }));
  assert.ok(violations.some((v) => /exactly.*keys|candidates.*question/i.test(v.message)));
});

test('checkComprehensionGate: machine format missing the candidates key is a violation', () => {
  const obj = JSON.parse(goodMachineDiagnosis());
  delete obj.candidates;
  const violations = checkComprehensionGate(JSON.stringify(obj), opts({ format: 'machine' }));
  assert.ok(violations.some((v) => /exactly.*keys|candidates.*question|array/i.test(v.message)));
});

test('checkComprehensionGate: machine format with 1 candidate (below minimum) is a violation', () => {
  const obj = JSON.parse(goodMachineDiagnosis());
  obj.candidates = obj.candidates.slice(0, 1);
  const violations = checkComprehensionGate(JSON.stringify(obj), opts({ format: 'machine' }));
  assert.ok(violations.some((v) => /2-4/i.test(v.message)));
});

test('checkComprehensionGate: machine format with 5 candidates (above maximum) is a violation', () => {
  const obj = JSON.parse(goodMachineDiagnosis());
  obj.candidates = [
    ...obj.candidates,
    { label: 'a', description: 'a' },
    { label: 'b', description: 'b' },
    { label: 'c', description: 'c' },
  ];
  const violations = checkComprehensionGate(JSON.stringify(obj), opts({ format: 'machine' }));
  assert.ok(violations.some((v) => /2-4/i.test(v.message)));
});

test('checkComprehensionGate: machine format candidate count mismatch against expectedCandidateCount is a violation', () => {
  const violations = checkComprehensionGate(goodMachineDiagnosis(), opts({ format: 'machine', expectedCandidateCount: 3 }));
  assert.ok(violations.some((v) => /expected exactly 3/i.test(v.message)));
});

test('checkComprehensionGate: machine format candidate with extra key is a violation', () => {
  const obj = JSON.parse(goodMachineDiagnosis());
  obj.candidates[0].extra = 'nope';
  const violations = checkComprehensionGate(JSON.stringify(obj), opts({ format: 'machine' }));
  assert.ok(violations.some((v) => /label.*description|exactly.*keys/i.test(v.message)));
});

test('checkComprehensionGate: machine format candidate with non-string label is a violation', () => {
  const obj = JSON.parse(goodMachineDiagnosis());
  obj.candidates[0].label = 42;
  const violations = checkComprehensionGate(JSON.stringify(obj), opts({ format: 'machine' }));
  assert.ok(violations.some((v) => /label/i.test(v.message)));
});

test('checkComprehensionGate: machine format candidate with empty description is a violation', () => {
  const obj = JSON.parse(goodMachineDiagnosis());
  obj.candidates[0].description = '   ';
  const violations = checkComprehensionGate(JSON.stringify(obj), opts({ format: 'machine' }));
  assert.ok(violations.some((v) => /description/i.test(v.message)));
});

test('checkComprehensionGate: machine format candidate with generic deny-listed label is a violation', () => {
  const obj = JSON.parse(goodMachineDiagnosis());
  obj.candidates[0].label = 'Something';
  const violations = checkComprehensionGate(JSON.stringify(obj), opts({ format: 'machine' }));
  assert.ok(violations.some((v) => /generic/i.test(v.message)));
});

test('checkComprehensionGate: machine format question missing is a violation', () => {
  const violations = checkComprehensionGate(
    JSON.stringify({ candidates: JSON.parse(goodMachineDiagnosis()).candidates }),
    opts({ format: 'machine' }),
  );
  assert.ok(violations.some((v) => /question/i.test(v.message)));
});

test('checkComprehensionGate: machine format question with no "?" is a violation', () => {
  const obj = JSON.parse(goodMachineDiagnosis());
  obj.question = 'Let me know which one it was.';
  const violations = checkComprehensionGate(JSON.stringify(obj), opts({ format: 'machine' }));
  assert.ok(violations.some((v) => /end with/i.test(v.message)));
});

test('checkComprehensionGate: machine format question with "?" not as the final character is a violation', () => {
  const obj = JSON.parse(goodMachineDiagnosis());
  obj.question = 'Which one is it? Let me know.';
  const violations = checkComprehensionGate(JSON.stringify(obj), opts({ format: 'machine' }));
  assert.ok(violations.some((v) => /end with/i.test(v.message)));
});

test('checkComprehensionGate: machine format question with two "?" is a violation', () => {
  const obj = JSON.parse(goodMachineDiagnosis());
  obj.question = 'Which one is it, really??';
  const violations = checkComprehensionGate(JSON.stringify(obj), opts({ format: 'machine' }));
  assert.ok(violations.some((v) => /exactly one/i.test(v.message)));
});

test('checkComprehensionGate: machine format question matching bare-re-ask deny set is a violation', () => {
  const obj = JSON.parse(goodMachineDiagnosis());
  obj.question = 'Can you clarify?';
  const violations = checkComprehensionGate(JSON.stringify(obj), opts({ format: 'machine' }));
  assert.ok(violations.some((v) => /bare-re-ask|bare re-ask/i.test(v.message)));
});

test('checkComprehensionGate: machine format "?" appearing in a candidate description is a violation (at most one across all string values)', () => {
  const obj = JSON.parse(goodMachineDiagnosis());
  obj.candidates[0].description = 'is this the rate limit?';
  const violations = checkComprehensionGate(JSON.stringify(obj), opts({ format: 'machine' }));
  assert.ok(violations.some((v) => /at most one/i.test(v.message)));
});

test('checkComprehensionGate: machine format markdown heading/bullets are exempt (no heading required)', () => {
  const obj = JSON.parse(goodMachineDiagnosis());
  const violations = checkComprehensionGate(JSON.stringify(obj), opts({ format: 'machine' }));
  assert.deepEqual(violations, []);
});

// ---------------------------------------------------------------------------
// repair / direct-repair, zero questions, no diagnosis structure required
// ---------------------------------------------------------------------------

test('checkComprehensionGate: repair with zero "?" and no diagnosis structure has zero violations', () => {
  const text = 'A rate limit is a cap on requests per minute. Here it resets every 60 seconds.';
  assert.deepEqual(checkComprehensionGate(text, opts({ action: 'repair' })), []);
});

test('checkComprehensionGate: direct-repair with zero "?" and no diagnosis structure has zero violations', () => {
  const text = '**Likely confusion points**\nThis is not a diagnosis, just a repair with structure ignored.';
  assert.deepEqual(checkComprehensionGate(text, opts({ action: 'direct-repair' })), []);
});

test('checkComprehensionGate: repair containing a bare "?" is a violation', () => {
  const text = 'Does that make sense? Anyway, a rate limit is a request cap.';
  const violations = checkComprehensionGate(text, opts({ action: 'repair' }));
  assert.ok(violations.length > 0);
});

test('checkComprehensionGate: direct-repair containing a bare "?" is a violation', () => {
  const text = 'A rate limit is a request cap, right?';
  const violations = checkComprehensionGate(text, opts({ action: 'direct-repair' }));
  assert.ok(violations.length > 0);
});

test('checkComprehensionGate: repair "?" inside inline code is excluded and not a violation', () => {
  const text = 'Set the `retries=3?` flag; it is not really optional despite the name.';
  assert.deepEqual(checkComprehensionGate(text, opts({ action: 'repair' })), []);
});

test('checkComprehensionGate: repair "?" inside a fenced code block is excluded and not a violation', () => {
  const text = ['A rate limit caps requests.', '```', 'is this a question?', '```'].join('\n');
  assert.deepEqual(checkComprehensionGate(text, opts({ action: 'repair' })), []);
});

test('checkComprehensionGate: repair "?" inside a blockquote is excluded and not a violation', () => {
  const text = ['A rate limit caps requests.', '> is this a question?'].join('\n');
  assert.deepEqual(checkComprehensionGate(text, opts({ action: 'repair' })), []);
});

test('checkComprehensionGate: repair behavior is identical for default and machine format ("?" still zero either way)', () => {
  const text = 'Does that make sense? Anyway, a rate limit is a request cap.';
  const defaultViolations = checkComprehensionGate(text, opts({ action: 'repair', format: 'default' }));
  const machineViolations = checkComprehensionGate(text, opts({ action: 'repair', format: 'machine' }));
  assert.ok(defaultViolations.length > 0);
  assert.ok(machineViolations.length > 0);
});

test('checkComprehensionGate: direct-repair is exempt from candidate/heading structure entirely', () => {
  const text = 'No heading, no bullets, no candidates, just a plain repair with no question mark at all.';
  assert.deepEqual(checkComprehensionGate(text, opts({ action: 'direct-repair', format: 'machine' })), []);
});

// ---------------------------------------------------------------------------
// Violation shape, checker id + severity
// ---------------------------------------------------------------------------

test('checkComprehensionGate: every violation reports checker "comprehension-gate" and severity "error"', () => {
  const text = 'Not a valid diagnosis at all.';
  const violations = checkComprehensionGate(text, opts());
  assert.ok(violations.length > 0);
  for (const v of violations) {
    assert.equal(v.checker, 'comprehension-gate');
    assert.equal(v.severity, 'error');
    assert.equal(typeof v.message, 'string');
    assert.ok(v.message.length > 0);
  }
});

// ---------------------------------------------------------------------------
// False positives, realistic well-formed inputs across all four actions
// ---------------------------------------------------------------------------

test('checkComprehensionGate: false positive check, realistic diagnose response is clean', () => {
  assert.deepEqual(checkComprehensionGate(goodDiagnosis(), opts({ action: 'diagnose' })), []);
});

test('checkComprehensionGate: false positive check, realistic rediagnose response is clean', () => {
  const text = [
    '**Likely confusion points**',
    '- **event ordering**: whether the handler fires before or after the commit',
    '- **transaction scope**: whether this write is inside the same transaction',
    '- **default value**: what happens when the field is unset',
    'Which of these is closest to what tripped you up?',
  ].join('\n');
  assert.deepEqual(checkComprehensionGate(text, opts({ action: 'rediagnose' })), []);
});

test('checkComprehensionGate: false positive check, realistic repair response with rhetorical-free prose is clean', () => {
  const text =
    'A cache invalidation happens the moment the write commits, not on a timer. That is why you saw the old value for zero seconds instead of the 30 you expected.';
  assert.deepEqual(checkComprehensionGate(text, opts({ action: 'repair' })), []);
});

test('checkComprehensionGate: false positive check, realistic direct-repair response is clean', () => {
  const text =
    'The `retries` flag counts total attempts, including the first one. Setting it to 3 means at most 2 retries after the initial call.';
  assert.deepEqual(checkComprehensionGate(text, opts({ action: 'direct-repair' })), []);
});
