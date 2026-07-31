import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  MARKER_PHRASES,
  normalizeReply,
  classifyComprehensionReply,
  type ReferenceContext,
  type ReferenceReason,
  type ReferenceInput,
} from '../src/reference-classifier.ts';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const casesDir = path.join(repoRoot, 'eval', 'golden', 'cases');

function input(reply: string, overrides: Partial<ReferenceInput> = {}): ReferenceInput {
  return { reply, hasPriorAssistantAnswer: true, context: 'same-topic', ...overrides };
}

// ---------------------------------------------------------------------------
// normalizeReply — M2 §2.2 steps 1-3 (NFKC, curly apostrophe, lowercase,
// trim/collapse Unicode whitespace)
// ---------------------------------------------------------------------------

test('normalizeReply: NFKC-normalizes fullwidth characters', () => {
  assert.equal(normalizeReply('ｈｕｈ'), 'huh');
});

test('normalizeReply: maps curly apostrophes (both directions) to ASCII', () => {
  assert.equal(normalizeReply('I’m lost'), "i'm lost");
  assert.equal(normalizeReply('I‘m lost'), "i'm lost");
});

test('normalizeReply: lowercases, trims, and collapses internal whitespace runs to one space', () => {
  assert.equal(normalizeReply('  HUH   \n\t '), 'huh');
  assert.equal(normalizeReply("I    don't\tget   it"), "i don't get it");
});

test('normalizeReply: collapses non-ASCII Unicode whitespace (e.g. ideographic space)', () => {
  assert.equal(normalizeReply('huh　　'), 'huh');
});

// ---------------------------------------------------------------------------
// classifyComprehensionReply — every frozen marker family variant
// ---------------------------------------------------------------------------

test('classifyComprehensionReply: every frozen marker phrase is an exact candidate', () => {
  assert.deepEqual(MARKER_PHRASES, [
    'huh',
    'what',
    'confused',
    'lost',
    "i don't get it",
    'i dont get it',
    "i don't understand",
    'i dont understand',
    'i am lost',
    "i'm lost",
    'im lost',
    "this doesn't make sense",
    'this doesnt make sense',
    "that doesn't make sense",
    'that doesnt make sense',
    "still don't get it",
    'still dont get it',
    "i still don't understand",
    'i still dont understand',
  ]);

  for (const phrase of MARKER_PHRASES) {
    const result = classifyComprehensionReply(input(phrase));
    assert.equal(result.candidate, true, phrase);
    assert.equal(result.reason, 'marker', phrase);
    assert.equal(result.normalized, phrase);
  }
});

test('classifyComprehensionReply: marker matching is case-insensitive and tolerates trailing punctuation', () => {
  const result = classifyComprehensionReply(input('HUH!!!'));
  assert.equal(result.candidate, true);
  assert.equal(result.reason, 'marker');
});

test('classifyComprehensionReply: curly-apostrophe marker variant still matches', () => {
  const result = classifyComprehensionReply(input('I’m lost'));
  assert.deepEqual(result, { candidate: true, reason: 'marker', normalized: "i'm lost" });
});

test('classifyComprehensionReply: whitespace-padded multi-word marker still matches', () => {
  const result = classifyComprehensionReply(input("  Still   DON'T get IT  "));
  assert.equal(result.candidate, true);
  assert.equal(result.reason, 'marker');
});

// ---------------------------------------------------------------------------
// 40/41 normalized code-point boundary, measured before terminal-punctuation
// strip
// ---------------------------------------------------------------------------

test('classifyComprehensionReply: exactly 40 normalized code points is still a lexical candidate', () => {
  const reply = 'huh' + '!'.repeat(37);
  assert.equal([...normalizeReply(reply)].length, 40);
  const result = classifyComprehensionReply(input(reply));
  assert.equal(result.candidate, true);
  assert.equal(result.reason, 'marker');
});

test('classifyComprehensionReply: 41 normalized code points is too-long, even with a marker inside', () => {
  const reply = 'huh' + '!'.repeat(38);
  assert.equal([...normalizeReply(reply)].length, 41);
  const result = classifyComprehensionReply(input(reply));
  assert.equal(result.candidate, false);
  assert.equal(result.reason, 'too-long');
});

// ---------------------------------------------------------------------------
// quoted-or-code: whole reply wrapped in matching quotes/backticks/fences
// ---------------------------------------------------------------------------

test('classifyComprehensionReply: whole reply wrapped in matching double quotes is quoted-or-code', () => {
  const result = classifyComprehensionReply(input('"huh"'));
  assert.equal(result.candidate, false);
  assert.equal(result.reason, 'quoted-or-code');
});

test('classifyComprehensionReply: whole reply wrapped in matching single quotes is quoted-or-code', () => {
  const result = classifyComprehensionReply(input("'confused'"));
  assert.equal(result.candidate, false);
  assert.equal(result.reason, 'quoted-or-code');
});

test('classifyComprehensionReply: whole reply wrapped in inline backticks is quoted-or-code', () => {
  const result = classifyComprehensionReply(input("`i don't understand`"));
  assert.equal(result.candidate, false);
  assert.equal(result.reason, 'quoted-or-code');
});

test('classifyComprehensionReply: whole reply wrapped in a fenced code block is quoted-or-code', () => {
  const result = classifyComprehensionReply(input('```\nconfused\n```'));
  assert.equal(result.candidate, false);
  assert.equal(result.reason, 'quoted-or-code');
});

test('classifyComprehensionReply: a marker only partially quoted (not the whole reply) is not quoted-or-code', () => {
  const result = classifyComprehensionReply(input('He said "huh" loudly.'));
  assert.notEqual(result.reason, 'quoted-or-code');
});

// ---------------------------------------------------------------------------
// specific-question: ends in "?", is not an exact marker, and has text beyond
// a marker
// ---------------------------------------------------------------------------

test('classifyComprehensionReply: a specific question containing a quoted marker word is specific-question', () => {
  const result = classifyComprehensionReply(input('What does "huh" mean here?'));
  assert.equal(result.candidate, false);
  assert.equal(result.reason, 'specific-question');
});

test('classifyComprehensionReply: a marker embedded with extra text before "?" is specific-question', () => {
  const result = classifyComprehensionReply(input('confused, right?'));
  assert.equal(result.candidate, false);
  assert.equal(result.reason, 'specific-question');
});

test('classifyComprehensionReply: an unrelated question without marker text is no-marker', () => {
  assert.equal(classifyComprehensionReply(input('Why?')).reason, 'no-marker');
  assert.equal(classifyComprehensionReply(input('Is that somewhat unusual?')).reason, 'no-marker');
});

test('classifyComprehensionReply: a bare marker with a trailing "?" is still an exact marker, not specific-question', () => {
  const huh = classifyComprehensionReply(input('huh?'));
  assert.equal(huh.candidate, true);
  assert.equal(huh.reason, 'marker');

  const confused = classifyComprehensionReply(input('confused?'));
  assert.equal(confused.candidate, true);
  assert.equal(confused.reason, 'marker');
});

// ---------------------------------------------------------------------------
// no-marker: unrelated or extra-text replies that are not lexical candidates
// ---------------------------------------------------------------------------

test('classifyComprehensionReply: unrelated prose is no-marker', () => {
  const result = classifyComprehensionReply(input('The sky is blue today.'));
  assert.equal(result.candidate, false);
  assert.equal(result.reason, 'no-marker');
});

test('classifyComprehensionReply: a marker phrase with unrelated extra text (no trailing "?") is no-marker', () => {
  const result = classifyComprehensionReply(input("I don't understand this null lookup"));
  assert.equal(result.candidate, false);
  assert.equal(result.reason, 'no-marker');
});

test('classifyComprehensionReply: an empty reply is no-marker', () => {
  const result = classifyComprehensionReply(input(''));
  assert.equal(result.candidate, false);
  assert.equal(result.reason, 'no-marker');
  assert.equal(result.normalized, '');
});

test('classifyComprehensionReply: a whitespace-only reply is no-marker', () => {
  const result = classifyComprehensionReply(input('   \t\n  '));
  assert.equal(result.candidate, false);
  assert.equal(result.reason, 'no-marker');
  assert.equal(result.normalized, '');
});

// ---------------------------------------------------------------------------
// Rule precedence and exclusion collisions (M2 §2.4 order)
// ---------------------------------------------------------------------------

test('precedence: no-prior-answer beats every other rule, including context-reset', () => {
  const withoutReset = classifyComprehensionReply(input('huh', { hasPriorAssistantAnswer: false }));
  assert.equal(withoutReset.reason, 'no-prior-answer');

  const withReset = classifyComprehensionReply(input('huh', { hasPriorAssistantAnswer: false, context: 'new-task' }));
  assert.equal(withReset.reason, 'no-prior-answer');
});

const RESET_CONTEXTS: ReferenceContext[] = ['new-task', 'topic-change', 'session-reset'];

test('precedence: context-reset beats an exact marker', () => {
  for (const context of RESET_CONTEXTS) {
    const result = classifyComprehensionReply(input('huh', { context }));
    assert.equal(result.reason, 'context-reset', context);
    assert.equal(result.candidate, false, context);
  }
});

test('precedence: context-reset beats too-long', () => {
  const reply = 'huh' + '!'.repeat(38);
  const result = classifyComprehensionReply(input(reply, { context: 'topic-change' }));
  assert.equal(result.reason, 'context-reset');
});

test('precedence: context-reset beats quoted-or-code', () => {
  const result = classifyComprehensionReply(input('"huh"', { context: 'session-reset' }));
  assert.equal(result.reason, 'context-reset');
});

test('precedence: context-reset beats specific-question', () => {
  const result = classifyComprehensionReply(input('What does "huh" mean here?', { context: 'new-task' }));
  assert.equal(result.reason, 'context-reset');
});

test('precedence: too-long beats quoted-or-code', () => {
  const reply = '`' + 'x'.repeat(45) + '`';
  assert.ok([...normalizeReply(reply)].length > 40);
  const result = classifyComprehensionReply(input(reply));
  assert.equal(result.reason, 'too-long');
});

test('precedence: too-long beats specific-question', () => {
  const reply = 'Why does this particular long explanation about caches still confuse me a lot?';
  assert.ok([...normalizeReply(reply)].length > 40);
  const result = classifyComprehensionReply(input(reply));
  assert.equal(result.reason, 'too-long');
});

test('precedence: too-long beats an exact marker padded with trailing punctuation', () => {
  const reply = 'huh' + '!'.repeat(38);
  const result = classifyComprehensionReply(input(reply));
  assert.equal(result.reason, 'too-long');
});

test('precedence: quoted-or-code beats no-marker for a quoted non-marker phrase', () => {
  const result = classifyComprehensionReply(input('"just checking in"'));
  assert.equal(result.reason, 'quoted-or-code');
});

test('quoted-or-code: mismatched backtick runs are not matching wrappers', () => {
  assert.equal(classifyComprehensionReply(input('`huh``')).reason, 'no-marker');
  assert.equal(classifyComprehensionReply(input('```huh`')).reason, 'no-marker');
});

// ---------------------------------------------------------------------------
// Deleting golden fixture labels/metadata cannot change classification: the
// classifier is proven driven only by turn content, never by expected_action,
// category, profile, reference_facts, must_preserve, or expected_checks. Each
// case below is redacted to bare {role, content} before classifying, and the
// result is compared against classifying the same content pulled from the
// full, un-redacted fixture -- redaction must not move the outcome.
// ---------------------------------------------------------------------------

interface RawTurn {
  role: string;
  content: string;
  [key: string]: unknown;
}

interface RawCase {
  turns?: RawTurn[];
  [key: string]: unknown;
}

function loadCase(id: string): RawCase {
  return JSON.parse(readFileSync(path.join(casesDir, `${id}.json`), 'utf8')) as RawCase;
}

function redactToContentOnly(raw: RawCase): { role: string; content: string }[] {
  return (raw.turns ?? []).map((turn) => ({ role: turn.role, content: turn.content }));
}

function assertRedactionInvariant(
  raw: RawCase,
  turnIndex: number,
  overrides: Partial<ReferenceInput>,
  expectedReason: ReferenceReason,
): void {
  const original = raw.turns![turnIndex]!;
  const redacted = redactToContentOnly(raw)[turnIndex]!;
  assert.equal(original.role, 'user', `turns[${turnIndex}] must be a user turn`);
  assert.equal(redacted.role, 'user');

  assert.ok('category' in raw, 'fixture case must carry metadata to strip');
  assert.ok('expected_action' in original, 'fixture user turn must carry metadata to strip');
  assert.ok(!('expected_action' in redacted), 'redacted turn must omit fixture metadata');
  const fromFullFixture = classifyComprehensionReply({
    ...raw,
    ...original,
    reply: original.content,
    hasPriorAssistantAnswer: true,
    context: 'same-topic',
    ...overrides,
  } as ReferenceInput);
  const fromRedactedFixture = classifyComprehensionReply(input(redacted.content, overrides));

  assert.deepEqual(fromRedactedFixture, fromFullFixture, 'redacting fixture metadata must not change classification');
  assert.equal(fromRedactedFixture.reason, expectedReason);
}

test('fixture proof: marker-family cases classify the same with all labels/metadata stripped', () => {
  assertRedactionInvariant(loadCase('comprehension-gate-marker-short-boundary'), 2, {}, 'marker');
  assertRedactionInvariant(loadCase('comprehension-gate-marker-first-failure'), 2, {}, 'marker');
  assertRedactionInvariant(loadCase('comprehension-gate-marker-framing-taper'), 2, {}, 'marker');
  assertRedactionInvariant(loadCase('comprehension-gate-marker-continued-taper'), 2, {}, 'marker');
});

test('fixture proof: quoted/inline/fenced false positives classify the same with all labels/metadata stripped', () => {
  const raw = loadCase('comprehension-gate-false-positive-quoted-code');
  assertRedactionInvariant(raw, 2, {}, 'quoted-or-code');
  assertRedactionInvariant(raw, 4, {}, 'quoted-or-code');
  assertRedactionInvariant(raw, 6, {}, 'quoted-or-code');
});

test('fixture proof: specific-question/embedded-marker false positives classify the same with all labels/metadata stripped', () => {
  const raw = loadCase('comprehension-gate-false-positive-specific-embedded');
  assertRedactionInvariant(raw, 2, {}, 'specific-question');
  assertRedactionInvariant(raw, 4, {}, 'no-marker');
});

test('fixture proof: new-task/topic-change/session-reset false positives classify the same with all labels/metadata stripped', () => {
  const raw = loadCase('comprehension-gate-false-positive-context-resets');
  assertRedactionInvariant(raw, 2, { context: 'new-task' }, 'context-reset');
  assertRedactionInvariant(raw, 4, { context: 'topic-change' }, 'context-reset');
  assertRedactionInvariant(raw, 6, { context: 'session-reset' }, 'context-reset');
});

test('classifier source has no runtime capability imports or global process/network access', () => {
  const source = readFileSync(path.join(repoRoot, 'src', 'reference-classifier.ts'), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/mu);
  assert.doesNotMatch(source, /\b(?:require|process|fetch)\s*(?:\.|\()/u);
});

test('fixture proof: 41-code-point boundary and adversarial-data false positives classify the same with all labels/metadata stripped', () => {
  const raw = loadCase('comprehension-gate-false-positive-boundary-adversarial');
  assertRedactionInvariant(raw, 2, {}, 'too-long');
  assertRedactionInvariant(raw, 4, {}, 'too-long');
});
