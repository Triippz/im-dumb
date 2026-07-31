import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_PROFILE, type Profile } from '../src/profile.ts';
import {
  CHECKER_IDS,
  SENTENCE_CAP_OVER_RATIO_THRESHOLD,
  ADHD_MAX_SIBLINGS,
  SKILL_BODY_WORD_WARN_THRESHOLD,
  DESCRIPTION_MAX_LENGTH,
  checkSentenceCap,
  checkForbiddenPhrases,
  checkOneTermOneConcept,
  checkOutputShapeMarkers,
  checkAdhdStructure,
  checkSkillFrontmatter,
} from '../src/checkers.ts';
import { FILLER_PHRASES, CONCEPT_SYNONYM_SETS } from '../src/data/lexicon.ts';

function withProfile(overrides: Partial<Profile>): Profile {
  return { ...DEFAULT_PROFILE, ...overrides };
}

// ---------------------------------------------------------------------------
// checker id registry (D14: enum consumed by golden-schema.ts)
// ---------------------------------------------------------------------------

test('CHECKER_IDS covers the FR7 checker set', () => {
  for (const id of [
    'sentence-cap',
    'forbidden-phrases',
    'one-term-one-concept',
    'output-shape',
    'adhd-structure',
    'frontmatter',
    'profile-schema',
    'golden-case-schema',
    'comprehension-gate',
  ]) {
    assert.ok((CHECKER_IDS as readonly string[]).includes(id), `expected CHECKER_IDS to include "${id}"`);
  }
});

// ---------------------------------------------------------------------------
// D7 — sentence cap: segmentation + exclusions
// ---------------------------------------------------------------------------

test('checkSentenceCap: compliant text (all sentences under cap) has no violations', () => {
  const profile = withProfile({ sentence_length_cap: 20 });
  const text = 'Cats are mammals. They have four legs. Many people keep them as pets.';
  assert.deepEqual(checkSentenceCap(text, profile), []);
});

test('checkSentenceCap: more than 10% of sentences over cap is an error', () => {
  const profile = withProfile({ sentence_length_cap: 5 });
  // 2 short sentences (<=5 words), 2 long sentences (>5 words) => 50% over cap.
  const text =
    'Cats sleep a lot. Dogs run outside daily. This sentence definitely has more than five words in it. Another long sentence goes well past the five word cap easily.';
  const violations = checkSentenceCap(text, profile);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.checker, 'sentence-cap');
  assert.equal(violations[0]!.severity, 'error');
  assert.match(violations[0]!.message, /\d+\/\d+ sentences/);
});

test('checkSentenceCap: exactly at the 10% threshold is not an error (strictly-greater-than rule)', () => {
  const profile = withProfile({ sentence_length_cap: 3 });
  // 10 sentences total, exactly 1 over cap -> ratio 0.10, not > 0.10.
  const shortSentences = Array.from({ length: 9 }, (_, i) => `Word number ${i}.`).join(' ');
  const longSentence = 'This one sentence has clearly more than three words in it.';
  const text = `${shortSentences} ${longSentence}`;
  assert.deepEqual(checkSentenceCap(text, profile), []);
  assert.equal(SENTENCE_CAP_OVER_RATIO_THRESHOLD, 0.1);
});

test('checkSentenceCap: fenced code blocks are excluded from prose sentence counting', () => {
  const profile = withProfile({ sentence_length_cap: 5 });
  const text = [
    'Short answer here.',
    '```',
    'this pretend code line has way more than five words in it and should never count',
    '```',
    'Another short line.',
  ].join('\n');
  assert.deepEqual(checkSentenceCap(text, profile), []);
});

test('checkSentenceCap: inline code spans are excluded from prose sentence counting', () => {
  const profile = withProfile({ sentence_length_cap: 6 });
  const text = 'Run `this is a very long inline code span with many words` now.';
  assert.deepEqual(checkSentenceCap(text, profile), []);
});

test('checkSentenceCap: blockquote lines are excluded from prose sentence counting', () => {
  const profile = withProfile({ sentence_length_cap: 5 });
  const text = ['Short line stands alone.', '> This quoted sentence has clearly more than five words in it.'].join('\n');
  assert.deepEqual(checkSentenceCap(text, profile), []);
});

test('checkSentenceCap: heading lines are excluded from prose sentence counting', () => {
  const profile = withProfile({ sentence_length_cap: 5 });
  const text = ['# This Heading Definitely Has More Than Five Words', 'Short line stands alone.'].join('\n');
  assert.deepEqual(checkSentenceCap(text, profile), []);
});

test('checkSentenceCap: prose that is entirely excluded (code-only) has no violations', () => {
  const profile = withProfile({ sentence_length_cap: 5 });
  const text = '```\nsome code that is definitely longer than five words right here\n```';
  assert.deepEqual(checkSentenceCap(text, profile), []);
});

test('checkSentenceCap: numbered list markers are not counted as their own one-word sentences', () => {
  const profile = withProfile({ sentence_length_cap: 5 });
  // Each list item is a compliant short sentence; without marker-stripping the
  // leading "1."/"2."/"3." would segment as extra 1-word "sentences" and
  // dilute the over-cap ratio below detection for a genuinely long item.
  const text = [
    '1. Short step one.',
    '2. Short step two.',
    '3. This third step is deliberately much longer than the five word cap allows.',
  ].join('\n');
  const violations = checkSentenceCap(text, profile);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!.message, /^1\/3 sentences/);
});

test('checkSentenceCap: a link inside a compliant sentence does not cause a spurious extra sentence', () => {
  const profile = withProfile({ sentence_length_cap: 20 });
  const text = 'Read the docs at example.com/path for setup details.';
  assert.deepEqual(checkSentenceCap(text, profile), []);
});

test('checkSentenceCap: empty text has no violations', () => {
  const profile = withProfile({});
  assert.deepEqual(checkSentenceCap('', profile), []);
});

test('checkSentenceCap: abbreviations mid-sentence do not create a false negative on a long sentence', () => {
  const profile = withProfile({ sentence_length_cap: 20 });
  // Deliberately long on both sides of "e.g."/"v1.2" so the violation is
  // detected whether or not the segmenter treats the abbreviation as a break.
  const text =
    'We are shipping a fairly large release this quarter that adds several new capabilities for enterprise teams, e.g. version v1.2 support for legacy configuration files, expanded audit logging, and a handful of other requested improvements that customers have been asking about for months now.';
  const violations = checkSentenceCap(text, profile);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.severity, 'error');
});

// ---------------------------------------------------------------------------
// Forbidden phrases: built-in filler lexicon ∪ profile.forbidden_phrases
// ---------------------------------------------------------------------------

test('checkForbiddenPhrases: no violations when text is clean', () => {
  const profile = withProfile({});
  assert.deepEqual(checkForbiddenPhrases('The server restarts on failure.', profile), []);
});

test('checkForbiddenPhrases: built-in filler lexicon phrase triggers an error, case-insensitive', () => {
  const profile = withProfile({});
  const phrase = FILLER_PHRASES[0]!;
  const violations = checkForbiddenPhrases(`This is ${phrase.toUpperCase()} fine.`, profile);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.checker, 'forbidden-phrases');
  assert.equal(violations[0]!.severity, 'error');
});

test('checkForbiddenPhrases: matches respect word boundaries (substring inside another word does not match)', () => {
  const profile = withProfile({});
  assert.ok(FILLER_PHRASES.includes('just'), 'fixture assumes "just" is in the built-in filler lexicon');
  const violations = checkForbiddenPhrases('Please adjust the settings before you continue.', profile);
  assert.deepEqual(violations, []);
});

test('checkForbiddenPhrases: profile.forbidden_phrases are checked in addition to the built-in lexicon', () => {
  const profile = withProfile({ forbidden_phrases: ['synergy'] });
  const violations = checkForbiddenPhrases('Great synergy between the teams.', profile);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!.message, /synergy/i);
});

test('checkForbiddenPhrases: inline and fenced code do not hide a forbidden phrase', () => {
  const profile = withProfile({ forbidden_phrases: ['synergy'] });
  const violations = checkForbiddenPhrases('Source label: `synergy`.\n```text\nsynergy\n```', profile);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!.message, /synergy/i);
});

test('checkForbiddenPhrases: reports one violation per distinct phrase, not per occurrence', () => {
  const profile = withProfile({});
  const phrase = FILLER_PHRASES[0]!;
  const violations = checkForbiddenPhrases(`${phrase} then ${phrase} again.`, profile);
  assert.equal(violations.length, 1);
});

// ---------------------------------------------------------------------------
// D5 — one term per concept (lexical, conservative)
// ---------------------------------------------------------------------------

test('checkOneTermOneConcept: no violation when only one term from a concept set is used', () => {
  assert.deepEqual(checkOneTermOneConcept('Use the config file to set options.'), []);
});

test('checkOneTermOneConcept: no violation when text uses none of the curated terms', () => {
  assert.deepEqual(checkOneTermOneConcept('The sky is blue today.'), []);
});

test('checkOneTermOneConcept: flags mixing two synonyms from the same curated concept set', () => {
  const [termA, termB] = CONCEPT_SYNONYM_SETS[0]!;
  const violations = checkOneTermOneConcept(`First ${termA} the tool, then ${termB} it again later.`);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.checker, 'one-term-one-concept');
  assert.equal(violations[0]!.severity, 'error');
  assert.match(violations[0]!.message, new RegExp(termA!, 'i'));
  assert.match(violations[0]!.message, new RegExp(termB!, 'i'));
});

test('checkOneTermOneConcept: ignores an inline or fenced source label when prose uses one plain term', () => {
  const [sourceTerm, plainTerm] = CONCEPT_SYNONYM_SETS[0]!;
  assert.deepEqual(checkOneTermOneConcept(`Source term: \`${sourceTerm}\`. Continue with ${plainTerm} in prose.`), []);
  assert.deepEqual(
    checkOneTermOneConcept(`Source term:\n\`\`\`text\n${sourceTerm}\n\`\`\`\nContinue with ${plainTerm} in prose.`),
    [],
  );
});

test('checkOneTermOneConcept: flags each concept set independently', () => {
  const [firstA, firstB] = CONCEPT_SYNONYM_SETS[0]!;
  const [secondA, secondB] = CONCEPT_SYNONYM_SETS[1]!;
  const text = `${firstA} it, ${firstB} it, then ${secondA} it, ${secondB} it.`;
  const violations = checkOneTermOneConcept(text);
  assert.equal(violations.length, 2);
});

test('checkOneTermOneConcept: word boundaries prevent a substring false match', () => {
  const [termA] = CONCEPT_SYNONYM_SETS[0]!;
  assert.ok(termA, 'fixture assumes at least one concept set exists');
  // "user" contains "use" as a substring; must not count as a use of the term "use".
  const violations = checkOneTermOneConcept('The user opened the utilize-free settings page.');
  assert.deepEqual(violations, []);
});

// ---------------------------------------------------------------------------
// D9 — output-shape markers + exemptions
// ---------------------------------------------------------------------------

const MULTI_PARAGRAPH_LEAD =
  'This is the direct answer to the question, stated plainly and without extra hedging so the reader gets it immediately.';

test('checkOutputShapeMarkers: narrative output_shape never checks markers', () => {
  const profile = withProfile({ output_shape: 'narrative' });
  assert.deepEqual(checkOutputShapeMarkers('no markers here at all, just prose.', profile), []);
});

test('checkOutputShapeMarkers: simple answer (single paragraph, <=3 sentences) is exempt', () => {
  const profile = withProfile({ output_shape: 'answer-first' });
  const text = 'Restart the service. It will pick up the new config. No further action is needed.';
  assert.deepEqual(checkOutputShapeMarkers(text, profile), []);
});

test('checkOutputShapeMarkers: single paragraph with more than 3 sentences is no longer exempt', () => {
  const profile = withProfile({ output_shape: 'answer-first' });
  const text = 'Restart the service. It will pick up the new config. No further action is needed. This is a fourth sentence.';
  const violations = checkOutputShapeMarkers(text, profile);
  assert.ok(violations.some((v) => /Answer/.test(v.message)));
});

test('checkOutputShapeMarkers: full compliant marker sequence has no violations', () => {
  const profile = withProfile({ output_shape: 'answer-first' });
  const text = [
    '**Answer**',
    MULTI_PARAGRAPH_LEAD,
    '',
    '**Why**',
    'This works because the config reload path already handles this case.',
    '',
    '**Steps**',
    '- Restart the service',
    '',
    '**Example**',
    'systemctl restart myservice',
  ].join('\n');
  assert.deepEqual(checkOutputShapeMarkers(text, profile), []);
});

test('checkOutputShapeMarkers: missing required Answer marker is an error', () => {
  const profile = withProfile({ output_shape: 'answer-first' });
  const text = [MULTI_PARAGRAPH_LEAD, '', '**Why**', 'Because of the config reload path.'].join('\n');
  const violations = checkOutputShapeMarkers(text, profile);
  assert.ok(violations.some((v) => v.severity === 'error' && /missing required marker \*\*Answer\*\*/.test(v.message)));
});

test('checkOutputShapeMarkers: duplicate marker is an error', () => {
  const profile = withProfile({ output_shape: 'answer-first' });
  const text = ['**Answer**', MULTI_PARAGRAPH_LEAD, '', '**Why**', 'First reason.', '', '**Why**', 'Second reason.'].join('\n');
  const violations = checkOutputShapeMarkers(text, profile);
  assert.ok(violations.some((v) => /appears 2 times/.test(v.message)));
});

test('checkOutputShapeMarkers: out-of-order markers are an error', () => {
  const profile = withProfile({ output_shape: 'answer-first' });
  const text = ['**Why**', 'Because of the config reload path.', '', '**Answer**', MULTI_PARAGRAPH_LEAD].join('\n');
  const violations = checkOutputShapeMarkers(text, profile);
  assert.ok(violations.some((v) => /out of order/.test(v.message)));
});

test('checkOutputShapeMarkers: a marker-shaped line inside a fenced code block does not count', () => {
  const profile = withProfile({ output_shape: 'answer-first' });
  const text = ['```', '**Answer**', '```', '', '**Why**', 'Because of the config reload path.'].join('\n');
  const violations = checkOutputShapeMarkers(text, profile);
  assert.ok(violations.some((v) => /missing required marker \*\*Answer\*\*/.test(v.message)));
});

// ---------------------------------------------------------------------------
// D10 — ADHD structure heuristics (warn severity)
// ---------------------------------------------------------------------------

test('checkAdhdStructure: adhd_mode off never produces violations', () => {
  const profile = withProfile({ adhd_mode: false });
  const text = '- one\n- two\n- three\n- four\n- five';
  assert.deepEqual(checkAdhdStructure(text, profile), []);
});

test('checkAdhdStructure: simple answer (single paragraph, <=3 sentences) is exempt', () => {
  const profile = withProfile({ adhd_mode: true });
  const text = 'Restart the service. It will pick up the new config. No further action is needed.';
  assert.deepEqual(checkAdhdStructure(text, profile), []);
});

test('checkAdhdStructure: more than 3 sibling list items is a warning', () => {
  const profile = withProfile({ adhd_mode: true });
  const text = ['Direct answer up front here.', '', '## Details', '- one', '- two', '- three', '- four'].join('\n');
  const violations = checkAdhdStructure(text, profile);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.checker, 'adhd-structure');
  assert.equal(violations[0]!.severity, 'warn');
  assert.match(violations[0]!.message, /4 sibling items/);
  assert.equal(ADHD_MAX_SIBLINGS, 3);
});

test('checkAdhdStructure: a multi-paragraph response with no headings or bold-line markers is a warning', () => {
  const profile = withProfile({ adhd_mode: true });
  const text = ['Direct answer up front here as plain prose.', '', 'Some more supporting detail as a second plain paragraph.'].join('\n');
  const violations = checkAdhdStructure(text, profile);
  assert.ok(violations.some((v) => /headed segments/.test(v.message)));
});

test('checkAdhdStructure: D9 bold-line markers satisfy the D10 headed-segment requirement', () => {
  const profile = withProfile({ adhd_mode: true, output_shape: 'answer-first' });
  const text = ['**Answer**', 'Direct answer up front here as plain prose.', '', '**Why**', 'Supporting detail as a second paragraph.'].join(
    '\n',
  );
  const violations = checkAdhdStructure(text, profile);
  assert.ok(!violations.some((v) => /headed segments/.test(v.message)));
});

test('checkAdhdStructure: starting with a list item instead of a direct answer is a warning', () => {
  const profile = withProfile({ adhd_mode: true });
  const text = ['- one', '- two', '', 'Some prose after the list.'].join('\n');
  const violations = checkAdhdStructure(text, profile);
  assert.ok(violations.some((v) => /direct answer/.test(v.message)));
});

test('checkAdhdStructure: list-like lines inside a fenced code block do not count toward the sibling-item run', () => {
  const profile = withProfile({ adhd_mode: true });
  const text = [
    'Direct answer up front here as plain prose.',
    '',
    '## Details',
    '```',
    '- one',
    '- two',
    '- three',
    '- four',
    '```',
  ].join('\n');
  assert.deepEqual(checkAdhdStructure(text, profile), []);
});

test('checkAdhdStructure: a bold-line marker inside a fenced code block does not satisfy the headed-segment requirement', () => {
  const profile = withProfile({ adhd_mode: true });
  const text = [
    'Direct answer up front here as plain prose.',
    '',
    '```',
    '**Note**',
    '```',
    '',
    'Some more supporting detail as a second plain paragraph.',
  ].join('\n');
  const violations = checkAdhdStructure(text, profile);
  assert.ok(violations.some((v) => /headed segments/.test(v.message)));
});

test('checkAdhdStructure: compliant structured response has no violations', () => {
  const profile = withProfile({ adhd_mode: true });
  const text = ['Direct answer up front here as plain prose.', '', '## Details', '- one', '- two', '- three'].join('\n');
  assert.deepEqual(checkAdhdStructure(text, profile), []);
});

// ---------------------------------------------------------------------------
// D13 — SKILL frontmatter subset checks
// ---------------------------------------------------------------------------

function frontmatterDoc(fields: string, body = 'Body text.'): string {
  return `---\n${fields}\n---\n${body}`;
}

test('checkSkillFrontmatter: valid minimal frontmatter has no violations', () => {
  const content = frontmatterDoc('name: im-dumb\ndescription: Shapes responses to a user profile.\nmetadata:\n  version: 0.1.0');
  assert.deepEqual(checkSkillFrontmatter(content, { expectedName: 'im-dumb' }), []);
});

test('checkSkillFrontmatter: name not matching the expected directory name is an error', () => {
  const content = frontmatterDoc('name: wrong-name\ndescription: Shapes responses to a user profile.\nmetadata:\n  version: 0.1.0');
  const violations = checkSkillFrontmatter(content, { expectedName: 'im-dumb' });
  assert.ok(violations.some((v) => v.severity === 'error' && /does not match expected/.test(v.message)));
});

test('checkSkillFrontmatter: missing description is an error', () => {
  const content = frontmatterDoc('name: im-dumb\nmetadata:\n  version: 0.1.0');
  const violations = checkSkillFrontmatter(content, { expectedName: 'im-dumb' });
  assert.ok(violations.some((v) => v.severity === 'error' && /missing required frontmatter field "description"/.test(v.message)));
});

test('checkSkillFrontmatter: description at or over the 1024-char ceiling is an error', () => {
  const longDescription = 'x'.repeat(DESCRIPTION_MAX_LENGTH);
  const content = frontmatterDoc(`name: im-dumb\ndescription: ${longDescription}\nmetadata:\n  version: 0.1.0`);
  const violations = checkSkillFrontmatter(content, { expectedName: 'im-dumb' });
  assert.ok(violations.some((v) => v.severity === 'error' && /description is \d+ chars/.test(v.message)));
});

test('checkSkillFrontmatter: description just under the ceiling has no length violation', () => {
  const okDescription = 'x'.repeat(DESCRIPTION_MAX_LENGTH - 1);
  const content = frontmatterDoc(`name: im-dumb\ndescription: ${okDescription}\nmetadata:\n  version: 0.1.0`);
  const violations = checkSkillFrontmatter(content, { expectedName: 'im-dumb' });
  assert.ok(!violations.some((v) => /description is \d+ chars/.test(v.message)));
});

test('checkSkillFrontmatter: missing metadata.version is an error', () => {
  const content = frontmatterDoc('name: im-dumb\ndescription: Shapes responses to a user profile.');
  const violations = checkSkillFrontmatter(content, { expectedName: 'im-dumb' });
  assert.ok(violations.some((v) => v.severity === 'error' && /metadata\.version/.test(v.message)));
});

test('checkSkillFrontmatter: missing frontmatter delimiters is an error', () => {
  const violations = checkSkillFrontmatter('name: im-dumb\ndescription: no delimiters here', { expectedName: 'im-dumb' });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.severity, 'error');
});

test('checkSkillFrontmatter: body over the word-count warn threshold is a warning, never blocking', () => {
  const body = Array.from({ length: SKILL_BODY_WORD_WARN_THRESHOLD + 1 }, () => 'word').join(' ');
  const content = frontmatterDoc('name: im-dumb\ndescription: Shapes responses to a user profile.\nmetadata:\n  version: 0.1.0', body);
  const violations = checkSkillFrontmatter(content, { expectedName: 'im-dumb' });
  const bodyViolation = violations.find((v) => /body is \d+ words/.test(v.message));
  assert.ok(bodyViolation);
  assert.equal(bodyViolation!.severity, 'warn');
});

test('checkSkillFrontmatter: body under budget has no body-size warning', () => {
  const content = frontmatterDoc('name: im-dumb\ndescription: Shapes responses to a user profile.\nmetadata:\n  version: 0.1.0', 'Short body.');
  const violations = checkSkillFrontmatter(content, { expectedName: 'im-dumb' });
  assert.ok(!violations.some((v) => /body is \d+ words/.test(v.message)));
});
