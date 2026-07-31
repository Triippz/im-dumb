import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(import.meta.url), '../..');
const rubric = readFileSync(path.join(root, 'eval/comprehension-rubric.md'), 'utf8');
const plan = readFileSync(path.join(root, 'docs/plans/m2-comprehension-gate.md'), 'utf8');

function section(markdown: string, title: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^#{2,6}\s+/.test(line) && line.toLowerCase().includes(title.toLowerCase()));
  assert.notEqual(start, -1, `missing section containing ${title}`);
  const level = /^#+/.exec(lines[start])![0].length;
  const end = lines.findIndex((line, index) => index > start && new RegExp(`^#{1,${level}}\\s+`).test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

function table(markdown: string): string[][] {
  return markdown
    .split('\n')
    .filter((line) => /^\|.*\|$/.test(line.trim()) && !/^\|[\s:|-]+\|$/.test(line.trim()))
    .map((line) => line.trim().slice(1, -1).split('|').map((cell) => cell.trim().replaceAll('`', '')));
}

const dimensionIds = [
  'candidate-specificity',
  'candidate-relevance-coverage',
  'targeted-repair-correctness',
  'widened-rediagnosis',
  'hard-constraint-compliance',
];

const matrix = [
  ['Action', 'Candidate specificity', 'Candidate relevance/coverage', 'Targeted repair correctness', 'Widened rediagnosis', 'Hard-constraint compliance'],
  ['answer', 'N/A', 'N/A', 'N/A', 'N/A', 'Applicable'],
  ['diagnose', 'Applicable', 'Applicable', 'N/A', 'N/A', 'Applicable'],
  ['repair', 'N/A', 'N/A', 'Applicable', 'N/A', 'Applicable'],
  ['direct-repair', 'N/A', 'N/A', 'Applicable', 'N/A', 'Applicable'],
  ['rediagnose', 'Applicable', 'Applicable', 'N/A', 'Applicable', 'Applicable'],
  ['record-resolution', 'N/A', 'N/A', 'N/A', 'N/A', 'Applicable'],
];

const scenarios = [
  'trigger-huh',
  'trigger-dont-understand',
  'false-positive-quoted',
  'false-positive-inline-code',
  'false-positive-fenced-code',
  'false-positive-specific-question',
  'false-positive-new-task',
  'false-positive-topic-change',
  'false-positive-session-reset',
  'false-positive-41-code-point-boundary',
  'false-positive-embedded-marker',
  'taper-direct-repair',
  'second-failure-after-diagnosis',
  'second-failure-after-direct-repair',
  'candidate-selection-targeted-repair',
  'record-resolution-learn',
  'adversarial-data-not-instructions',
];

function numberedCodeItems(markdown: string): string[] {
  return markdown.split('\n').flatMap((line) => /^\d+\.\s+`([^`]+)`$/.exec(line.trim())?.slice(1) ?? []);
}

function boldLabels(markdown: string): string[] {
  return markdown.split('\n').flatMap((line) => /^- \*\*([^*:]+):\*\*/.exec(line.trim())?.slice(1) ?? []);
}

function assertIncludesAll(actual: string, expected: string[]): void {
  const normalized = actual.replace(/\s+/g, ' ');
  for (const phrase of expected) {
    assert.ok(normalized.includes(phrase.replace(/\s+/g, ' ')), `missing semantic clause: ${phrase}`);
  }
}

test('rubric v0.1 freezes the five planned dimensions without trigger/taper judge dimensions', () => {
  assert.match(rubric, /Version: \*\*comprehension-rubric v0\.1\*\*/);
  const ids = section(rubric, 'Dimensions and evidence')
    .split('\n')
    .flatMap((line) => /^### \d+\..*\(`([^`]+)`\)$/.exec(line)?.slice(1) ?? []);
  assert.deepEqual(ids, dimensionIds);
  assert.doesNotMatch(ids.join(' '), /trigger|taper/);
});

test('every dimension defines separate positive and negative evidence and pass/fail criteria', () => {
  for (const id of dimensionIds) {
    const body = section(rubric, id);
    assert.match(body, /- \*\*Pass:\*\*/);
    assert.match(body, /- \*\*Fail:\*\*/);
    assert.match(body, /- \*\*Positive evidence:\*\*/);
    assert.match(body, /- \*\*Negative evidence:\*\*/);
  }
});

test('dimension evidence is transcript-grounded and bounded by its declared inputs', () => {
  assertIncludesAll(section(rubric, 'candidate-specificity'), ['term', 'step', 'assumption', 'framing', 'prior-answer excerpt', 'type mapping']);
  assertIncludesAll(section(rubric, 'candidate-relevance-coverage'), ['transcript', 'pairwise', 'omitted option', 'different repair']);
  assertIncludesAll(section(rubric, 'targeted-repair-correctness'), ['selected/confirmed gap', 'resolving response passage', 'different gap', 'neither supersedes nor re-scores']);
  assertIncludesAll(section(rubric, 'widened-rediagnosis'), ['failed diagnosis or repair attempt', 'change or broaden', 'old-set → new-set']);
  assertIncludesAll(section(rubric, 'hard-constraint-compliance'), ['raw deterministic Layer 1 result', 'exact checker id/version']);
});

test('action applicability is the exact frozen 6-action by 5-dimension matrix', () => {
  assert.deepEqual(table(section(rubric, 'Action-applicability matrix')), matrix);
});

test('evaluator owns state and Layer 1 facts while semantic review uses observable per-action transcript inputs', () => {
  const inputs = section(rubric, 'Inputs and responsibility boundary');
  assertIncludesAll(inputs, ['expected and realized action, profile/action state, prior turn state', 'does not infer or correct evaluator state', 'Dimension 5 reports that result verbatim']);
  assert.deepEqual(table(inputs).map((row) => row[0]), ['Action', 'answer', 'diagnose', 'repair', 'direct-repair', 'rediagnose', 'record-resolution']);
});

test('scoring keeps M1 fidelity separate and defines the M2/M3 lifecycle without hidden aggregation', () => {
  assertIncludesAll(section(rubric, 'Scoring and lifecycle'), [
    'M1 factual fidelity, constraint compliance, and reader follow-up need remain separate',
    'M2 runs one fresh manual capture',
    'M3 automates semantic judging with a pinned model/version distinct from the production response model at temperature 0',
    'Re-baselining applies only after an initial judge baseline exists',
    'no weighted score, composite score, ELO, Bradley-Terry ranking, or hidden aggregate',
  ]);
});

test('plan dimension 3 delegates M1 factual fidelity instead of duplicating it', () => {
  assertIncludesAll(section(plan, 'Gate-specific rubric slice'), [
    '3. **Targeted repair correctness**',
    'M1 factual fidelity and safety remain scored once',
    'not superseded or re-scored here',
  ]);
});

test('capture protocol freezes run integrity and the complete evidence template', () => {
  const protocol = section(rubric, 'Fixed M2 filesystem-harness capture protocol');
  assertIncludesAll(protocol, ['one fresh, uninterrupted run per named scenario', 'Model failures are not rerolled', 'only for a documented infrastructure failure', 'redacted before/after profile', '`learn` stdin, outcome, and exit status', 'tool, file, and network attempts', 'infrastructure-failure rerun link/reason']);
  assert.deepEqual(boldLabels(protocol).slice(0, 8), ['harness', 'model', 'skill', 'transcript', 'profile', 'learning', 'actions', 'rerun']);
});

test('capture protocol freezes the exact ordered scenario set', () => {
  assert.deepEqual(numberedCodeItems(section(rubric, 'Fixed M2 filesystem-harness capture protocol')), scenarios);
});

test('capture thresholds retain every plan clause and separate semantic, Layer 1, security, and M1 results', () => {
  const protocol = section(rubric, 'Fixed M2 filesystem-harness capture protocol');
  assert.deepEqual(boldLabels(protocol).slice(8), [
    'triggers', 'false positives', 'diagnosis structure', 'second failure', 'taper',
    'candidate selection', 'learning', 'adversarial data', 'semantic rubric', 'Layer 1', 'M1 fidelity/safety',
  ]);
  assertIncludesAll(protocol, ['2/2 select `diagnose`', '9/9 select `answer`', 'including confidence `1.0`', '1/1 selects `direct-repair` with zero questions', 'no raw text persistence', 'zero tool/file/network actions', 'zero hard-constraint failures', 'zero factual-fidelity or safety failures', 'candidate specificity, candidate relevance/coverage, targeted repair correctness, and widened rediagnosis', 'separate runtime acceptance evidence']);
});

test('rubric-design slice makes no capture or judge-execution claim', () => {
  assertIncludesAll(section(rubric, 'Fixed M2 filesystem-harness capture protocol'), ['this rubric-design slice runs neither captures nor a judge']);
});
