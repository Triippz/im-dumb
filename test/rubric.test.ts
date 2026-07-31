import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const rubricPath = path.join(repoRoot, 'eval', 'rubric.md');

function readRubric(): string {
  return readFileSync(rubricPath, 'utf8');
}

// Headings are lines starting with one or more '#'. Returns {level, text, start, end}
// where [start, end) is the line-index range of that heading's own section body
// (up to, not including, the next heading of the same or shallower level).
type Heading = { level: number; text: string; bodyStart: number; bodyEnd: number };

function parseHeadings(markdown: string): Heading[] {
  const lines = markdown.split('\n');
  const raw = lines
    .map((line, index) => {
      const match = /^(#{1,6})\s+(.*)$/.exec(line);
      return match ? { level: match[1].length, text: match[2].trim(), line: index } : null;
    })
    .filter((h): h is { level: number; text: string; line: number } => h !== null);

  return raw.map((h, i) => {
    const next = raw.slice(i + 1).find((candidate) => candidate.level <= h.level);
    return {
      level: h.level,
      text: h.text,
      bodyStart: h.line + 1,
      bodyEnd: next ? next.line : lines.length,
    };
  });
}

function section(markdown: string, headingText: string): string {
  const lines = markdown.split('\n');
  const heading = parseHeadings(markdown).find((h) => h.text.toLowerCase().includes(headingText.toLowerCase()));
  assert.ok(heading, `expected a heading containing "${headingText}"`);
  return lines.slice(heading!.bodyStart, heading!.bodyEnd).join('\n');
}

// ---------------------------------------------------------------------------
// Exactly three separable dimensions (prd.md §9.6, D14 traceability matrix)
// ---------------------------------------------------------------------------

test('rubric: defines exactly three dimensions', () => {
  const rubric = readRubric();
  const dimensionsBody = section(rubric, 'Dimensions');
  const count = dimensionsBody.split('\n').filter((line) => /^#{3}\s+/.test(line)).length;
  assert.equal(count, 3, `expected exactly 3 dimension subsections, found ${count}`);
});

test('rubric: the three dimensions are factual fidelity, constraint compliance, and reader follow-up need', () => {
  const rubric = readRubric();
  const dimensionsBody = section(rubric, 'Dimensions');
  const headingLines = dimensionsBody
    .split('\n')
    .filter((line) => /^#{3}\s+/.test(line))
    .map((line) => line.toLowerCase());
  assert.ok(headingLines.some((h) => h.includes('factual fidelity')), 'expected a "factual fidelity" dimension');
  assert.ok(
    headingLines.some((h) => h.includes('constraint compliance')),
    'expected a "constraint compliance" dimension',
  );
  assert.ok(
    headingLines.some((h) => h.includes('reader follow-up') || h.includes('reader follow up')),
    'expected a "reader follow-up need" dimension',
  );
});

test('rubric: factual fidelity dimension is scoped to reference_facts and must_preserve', () => {
  const rubric = readRubric();
  const body = section(rubric, 'Factual fidelity').toLowerCase();
  assert.ok(body.includes('reference_facts'), 'factual fidelity should reference the D14 reference_facts field');
  assert.ok(body.includes('must_preserve'), 'factual fidelity should reference the D14 must_preserve field');
});

test('rubric: reader follow-up need dimension requires enumerated blocking questions, pass means zero', () => {
  const rubric = readRubric();
  const body = section(rubric, 'Reader follow-up').toLowerCase();
  assert.ok(body.includes('blocking question'), 'should require the judge to name concrete blocking questions');
  assert.ok(body.includes('enumerat'), 'should require the judge to enumerate the questions, not just count them');
  assert.match(body, /pass[^.]*zero|zero[^.]*pass/, 'pass should be defined as exactly zero blocking questions');
});

// ---------------------------------------------------------------------------
// Independent pass/fail, raw reporting, no ELO/ranking aggregation (prd.md §9.6)
// ---------------------------------------------------------------------------

test('rubric: scoring contract requires independent per-dimension pass/fail with raw reporting', () => {
  const rubric = readRubric();
  const body = section(rubric, 'Scoring contract').toLowerCase();
  assert.ok(body.includes('independent'), 'each dimension should be scored independently');
  assert.ok(body.includes('raw'), 'per-dimension results should be reported raw (not collapsed)');
  assert.ok(body.includes('per-dimension') || body.includes('per dimension'));
});

test('rubric: scoring contract explicitly excludes ELO/ranking aggregation', () => {
  const rubric = readRubric();
  const body = section(rubric, 'Scoring contract').toLowerCase();
  assert.ok(body.includes('elo'), 'should name ELO explicitly when excluding it');
  assert.match(
    body,
    /\b(no|never|excluded?|not used|forbidden)\b[^.]*\belo\b|\belo\b[^.]*\b(excluded?|forbidden|never|not used)\b/,
    'should state that ELO/ranking-style aggregation is excluded',
  );
});

test('rubric: no heading anywhere frames scoring as an aggregate/ranking/ELO score', () => {
  const rubric = readRubric();
  const forbidden = /overall score|composite score|aggregate score|elo rating|bradley-terry ranking/i;
  for (const heading of parseHeadings(rubric)) {
    assert.doesNotMatch(heading.text, forbidden, `heading "${heading.text}" reads as an aggregate/ranking score`);
  }
});

// ---------------------------------------------------------------------------
// Judge model pinning, temp 0, differs from production model (prd.md §9.5, §9.6)
// ---------------------------------------------------------------------------

test('rubric: judge model is pinned by version at temperature 0', () => {
  const rubric = readRubric();
  const body = section(rubric, 'Judge model pinning').toLowerCase();
  assert.ok(body.includes('pinned'), 'judge model should be described as version-pinned');
  assert.ok(body.includes('temperature 0') || body.includes('temp 0'), 'judge calls should run at temperature 0');
});

test('rubric: judge model must differ from the production response model', () => {
  const rubric = readRubric();
  const body = section(rubric, 'Judge model pinning').toLowerCase();
  assert.ok(body.includes('production'), 'should reference the production/response model');
  assert.ok(
    body.includes('self-preference') ||
      body.includes('differ') ||
      body.includes('separate from') ||
      body.includes('must not be the same'),
    'should require the judge model to differ from the production model to reduce self-preference bias',
  );
});

// ---------------------------------------------------------------------------
// Rubric-adherence audit, judge-version re-baselining, dataset-change handling (prd.md §9.6, §9.10)
// ---------------------------------------------------------------------------

test('rubric: documents a periodic rubric-adherence audit with a concrete cadence', () => {
  const rubric = readRubric();
  const body = section(rubric, 'Rubric-adherence audit').toLowerCase();
  assert.match(
    body,
    /\b(daily|weekly|biweekly|monthly|quarterly|per release|per milestone|every \d+)\b/,
    'audit cadence should be a concrete interval, not a vague "periodically"',
  );
  assert.ok(body.includes('sample'), 'audit procedure should describe sampling already-judged cases');
  assert.ok(
    body.includes('independent'),
    'audit procedure should require the human to independently re-score, not just confirm the judge',
  );
  assert.ok(
    body.includes('compar'),
    'audit procedure should describe comparing human verdicts against judge verdicts',
  );
});

test('rubric: a judge model or version change triggers mandatory re-baselining', () => {
  const rubric = readRubric();
  const body = section(rubric, 'Judge-version change and re-baselining').toLowerCase();
  assert.ok(body.includes('judge model') || body.includes('judge version'));
  assert.ok(body.includes('re-baselin'));
  assert.ok(body.includes('freeze'), 'process should freeze the outgoing judge as the baseline');
  assert.ok(body.includes('golden set') || body.includes('golden dataset'), 'process should run the full golden set through both judges');
  assert.ok(body.includes('diff'), 'process should diff outgoing vs incoming judge verdicts');
  assert.ok(body.includes('document'), 'process should document the diff before adopting the new judge');
});

test('rubric: documents how dataset changes to the golden set are handled', () => {
  const rubric = readRubric();
  const body = section(rubric, 'Dataset-change handling').toLowerCase();
  assert.ok(body.includes('golden'), 'should reference the golden dataset');
  assert.ok(body.includes('re-baselin') || body.includes('manifest'));
  assert.ok(body.includes('new'), 'should describe handling for a new golden case');
  assert.ok(
    body.includes('edited') || body.includes('published'),
    'should describe handling for an edited/published case',
  );
  assert.ok(body.includes('deleted'), 'should describe handling for a deleted case');
});

test('rubric: documents manual review and disagreement handling to keep judge drift visible', () => {
  const rubric = readRubric();
  const body = section(rubric, 'Manual review and disagreement').toLowerCase();
  assert.ok(body.includes('disagreement'));
  assert.ok(body.includes('manual review') || body.includes('human'));
  assert.ok(body.includes('drift'));
});

// ---------------------------------------------------------------------------
// D12 provisional token-overhead ceilings: report-only in M1, blocking no earlier than M3 Gate 3
// ---------------------------------------------------------------------------

test('rubric: records D12 provisional token-overhead ceilings as report-only until M3 Gate 3', () => {
  const rubric = readRubric();
  const body = section(rubric, 'Token-overhead ceilings').toLowerCase();
  assert.ok(body.includes('30%'), 'should record the aggregate +30% ceiling');
  assert.ok(body.includes('60%'), 'should record the per-case +60% ceiling');
  assert.ok(body.includes('aggregate'));
  assert.ok(body.includes('per-case') || body.includes('per case'));
  assert.ok(body.includes('report-only'));
  assert.ok(body.includes('m3') && body.includes('gate 3'), 'should name M3 Gate 3 as the earliest blocking point');
});

// ---------------------------------------------------------------------------
// Doc-level sanity
// ---------------------------------------------------------------------------

test('rubric: eval/rubric.md is non-trivial and has a top-level title', () => {
  const rubric = readRubric();
  assert.ok(rubric.length > 500, 'rubric doc should not be a stub');
  assert.match(rubric, /^#\s+.+/m, 'rubric doc should have a top-level heading');
});
