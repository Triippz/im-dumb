import type { Profile } from './profile.ts';
import { FILLER_PHRASES, CONCEPT_SYNONYM_SETS } from './data/lexicon.ts';

// ---------------------------------------------------------------------------
// Checker registry (FR7) — consumed by src/golden-schema.ts (D14) for the
// `expected_checks[].checker` enum. Not every id below has an implementing
// function in this file: `profile-schema` is src/profile.ts's validate(),
// `golden-case-schema` is src/golden-schema.ts's validateGoldenCase().
// ---------------------------------------------------------------------------

export const CHECKER_IDS = [
  'sentence-cap',
  'forbidden-phrases',
  'one-term-one-concept',
  'output-shape',
  'adhd-structure',
  'frontmatter',
  'profile-schema',
  'golden-case-schema',
] as const;

export type CheckerId = (typeof CHECKER_IDS)[number];

export type Severity = 'error' | 'warn';

export interface Violation {
  checker: CheckerId;
  severity: Severity;
  message: string;
}

// ---------------------------------------------------------------------------
// Tuning constants (D3 — exported typed constants, no config file)
// ---------------------------------------------------------------------------

/** D7: >10% of prose sentences over the profile's word cap is an error. */
export const SENTENCE_CAP_OVER_RATIO_THRESHOLD = 0.1;

/** D10: at most this many sibling items per list/segment. */
export const ADHD_MAX_SIBLINGS = 3;

/** D9/D10: a single paragraph of at most this many sentences is a "simple answer". */
export const SIMPLE_ANSWER_MAX_SENTENCES = 3;

/** Invariant 4 / NFR3: description must stay strictly under this length. */
export const DESCRIPTION_MAX_LENGTH = 1024;

/** D12: SKILL.md body word count above this is a warn, never a block. */
export const SKILL_BODY_WORD_WARN_THRESHOLD = 1000;

/** D12: drafting target for SKILL.md body word count. */
export const SKILL_BODY_WORD_TARGET = 900;

// ---------------------------------------------------------------------------
// Shared text helpers
// ---------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordBoundaryRegex(phrase: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'i');
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const LIST_MARKER_PREFIX_RE = /^(?:[-*+]\s+|\d+[.)]\s+)/;

/** D7: prose used for sentence-cap purposes — strips fenced code, inline
 * code, blockquote lines, and heading lines. List markers ("1. ", "- ") are
 * stripped per line (not excluded like headings) so a numbered/bulleted
 * item's own leading digit-period isn't segmented as its own one-word
 * "sentence" — that would dilute the over-cap ratio (D7) and mask real
 * violations inside exactly the Steps-style lists ADHD mode favors. */
function extractProse(text: string): string {
  const withoutFences = text.replace(/```[\s\S]*?```/g, ' ');
  const kept = withoutFences
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('>')) return false;
      if (/^#{1,6}\s/.test(trimmed)) return false;
      return true;
    })
    .map((line) => line.trimStart().replace(LIST_MARKER_PREFIX_RE, ''));
  return kept.join(' ').replace(/`[^`]*`/g, ' ');
}

function splitSentences(prose: string): string[] {
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  const sentences: string[] = [];
  for (const { segment } of segmenter.segment(prose)) {
    const trimmed = segment.trim();
    if (trimmed.length > 0) sentences.push(trimmed);
  }
  return sentences;
}

const LIST_ITEM_RE = /^([-*+]\s|\d+[.)]\s)/;
const HEADING_RE = /^#{1,6}\s/;
const BOLD_LINE_RE = /^\*\*[^*]+\*\*$/;
const STRUCTURE_START_RE = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|\*\*[^*]+\*\*\s*$)/m;

/** D9/D10 shared exemption: a single paragraph of <=3 sentences with no
 * heading/list/quote/fence/bold-marker structure. */
function isSimpleAnswer(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  const paragraphs = trimmed.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  if (paragraphs.length !== 1) return false;
  if (STRUCTURE_START_RE.test(trimmed)) return false;
  const sentences = splitSentences(extractProse(trimmed));
  return sentences.length <= SIMPLE_ANSWER_MAX_SENTENCES;
}

/** D9: lines inside fenced code blocks or blockquotes, by index. */
function getFenceAndQuoteExcludedLineIndices(lines: string[]): Set<number> {
  const excluded = new Set<number>();
  let inFence = false;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      excluded.add(index);
      inFence = !inFence;
      return;
    }
    if (inFence) {
      excluded.add(index);
      return;
    }
    if (trimmed.startsWith('>')) {
      excluded.add(index);
    }
  });
  return excluded;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

// ---------------------------------------------------------------------------
// D7 — sentence cap
// ---------------------------------------------------------------------------

export function checkSentenceCap(text: string, profile: Profile): Violation[] {
  const cap = profile.sentence_length_cap;
  const sentences = splitSentences(extractProse(text));
  if (sentences.length === 0) return [];

  const offenders = sentences.map((sentence) => ({ sentence, words: wordCount(sentence) })).filter((s) => s.words > cap);
  const ratio = offenders.length / sentences.length;
  if (ratio <= SENTENCE_CAP_OVER_RATIO_THRESHOLD) return [];

  const top = offenders
    .slice()
    .sort((a, b) => b.words - a.words)
    .slice(0, 5)
    .map((o) => `"${truncate(o.sentence, 60)}" (${o.words} words)`);

  return [
    {
      checker: 'sentence-cap',
      severity: 'error',
      message: `${offenders.length}/${sentences.length} sentences exceed the ${cap}-word cap (over ${Math.round(
        SENTENCE_CAP_OVER_RATIO_THRESHOLD * 100,
      )}% threshold); top offenders: ${top.join('; ')}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Forbidden phrases: built-in filler lexicon ∪ profile.forbidden_phrases
// ---------------------------------------------------------------------------

export function checkForbiddenPhrases(text: string, profile: Profile): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<string>();
  for (const phrase of [...FILLER_PHRASES, ...profile.forbidden_phrases]) {
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (wordBoundaryRegex(phrase).test(text)) {
      violations.push({ checker: 'forbidden-phrases', severity: 'error', message: `forbidden phrase found: "${phrase}"` });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// D5 — one term per concept (lexical, conservative)
// ---------------------------------------------------------------------------

export function checkOneTermOneConcept(text: string): Violation[] {
  const violations: Violation[] = [];
  for (const set of CONCEPT_SYNONYM_SETS) {
    const used = set.filter((term) => wordBoundaryRegex(term).test(text));
    if (used.length > 1) {
      violations.push({
        checker: 'one-term-one-concept',
        severity: 'error',
        message: `mixed terminology for one concept: ${used.join(', ')}`,
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// D9 — output-shape markers + exemptions
// ---------------------------------------------------------------------------

const MARKER_SEQUENCE = ['Answer', 'Why', 'Steps', 'Example'] as const;
const REQUIRED_MARKERS = ['Answer', 'Why'] as const;

function markerLine(name: string): string {
  return `**${name}**`;
}

export function checkOutputShapeMarkers(text: string, profile: Profile): Violation[] {
  if (profile.output_shape !== 'answer-first') return [];
  if (isSimpleAnswer(text)) return [];

  const lines = text.split('\n');
  const excluded = getFenceAndQuoteExcludedLineIndices(lines);
  const positions = new Map<string, number[]>(MARKER_SEQUENCE.map((name) => [name, [] as number[]]));

  lines.forEach((line, index) => {
    if (excluded.has(index)) return;
    const trimmed = line.trim();
    for (const name of MARKER_SEQUENCE) {
      if (trimmed === markerLine(name)) {
        positions.get(name)!.push(index);
      }
    }
  });

  const violations: Violation[] = [];

  for (const name of MARKER_SEQUENCE) {
    const occurrences = positions.get(name)!;
    if (occurrences.length > 1) {
      violations.push({
        checker: 'output-shape',
        severity: 'error',
        message: `marker **${name}** appears ${occurrences.length} times, expected at most once`,
      });
    }
  }

  for (const name of REQUIRED_MARKERS) {
    if (positions.get(name)!.length === 0) {
      violations.push({ checker: 'output-shape', severity: 'error', message: `missing required marker **${name}**` });
    }
  }

  const present = MARKER_SEQUENCE.filter((name) => positions.get(name)!.length > 0);
  const sortedByPosition = [...present].sort((a, b) => positions.get(a)![0]! - positions.get(b)![0]!);
  const expectedOrder = MARKER_SEQUENCE.filter((name) => present.includes(name));
  if (JSON.stringify(sortedByPosition) !== JSON.stringify(expectedOrder)) {
    violations.push({
      checker: 'output-shape',
      severity: 'error',
      message: `markers out of order: found ${sortedByPosition.join(' -> ')}, expected ${expectedOrder.join(' -> ')}`,
    });
  }

  return violations;
}

// ---------------------------------------------------------------------------
// D10 — ADHD structure heuristics (warn severity)
// ---------------------------------------------------------------------------

export function checkAdhdStructure(text: string, profile: Profile): Violation[] {
  if (!profile.adhd_mode) return [];
  if (isSimpleAnswer(text)) return [];

  const violations: Violation[] = [];
  const lines = text.split('\n');
  const excluded = getFenceAndQuoteExcludedLineIndices(lines);

  let run = 0;
  let maxRun = 0;
  lines.forEach((line, index) => {
    if (excluded.has(index)) {
      run = 0;
      return;
    }
    const trimmed = line.trim();
    if (LIST_ITEM_RE.test(trimmed)) {
      run += 1;
      maxRun = Math.max(maxRun, run);
    } else {
      run = 0;
    }
  });
  if (maxRun > ADHD_MAX_SIBLINGS) {
    violations.push({
      checker: 'adhd-structure',
      severity: 'warn',
      message: `list has ${maxRun} sibling items, expected at most ${ADHD_MAX_SIBLINGS}`,
    });
  }

  const paragraphs = text.trim().split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const hasSegmentHead = lines.some((line, index) => {
    if (excluded.has(index)) return false;
    const trimmed = line.trim();
    return HEADING_RE.test(trimmed) || BOLD_LINE_RE.test(trimmed);
  });
  if (paragraphs.length > 1 && !hasSegmentHead) {
    violations.push({
      checker: 'adhd-structure',
      severity: 'warn',
      message: 'expected headed segments (markdown heading or bold-line marker) to chunk a multi-paragraph response',
    });
  }

  const firstNonBlank = lines.find((line) => line.trim().length > 0);
  if (firstNonBlank !== undefined && LIST_ITEM_RE.test(firstNonBlank.trim())) {
    violations.push({
      checker: 'adhd-structure',
      severity: 'warn',
      message: 'expected a direct answer before supporting details, response starts with a list item',
    });
  }

  return violations;
}

// ---------------------------------------------------------------------------
// D13 — SKILL.md frontmatter subset checks
// ---------------------------------------------------------------------------

export interface FrontmatterCheckOptions {
  expectedName: string;
}

const REQUIRED_TOP_LEVEL_FIELDS = ['name', 'description'] as const;

interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

const TOP_LEVEL_KEY_RE = /^([A-Za-z0-9_]+):\s*(.*)$/;
const NESTED_KEY_RE = /^\s+([A-Za-z0-9_]+):\s*(.*)$/;
const NESTED_LINE_RE = /^\s+[A-Za-z0-9_]+:\s*.*$/;

function parseFrontmatterSubset(content: string): ParsedFrontmatter | { error: string } {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { error: 'missing opening frontmatter delimiter "---"' };
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) {
    return { error: 'missing closing frontmatter delimiter "---"' };
  }

  const frontmatter: Record<string, unknown> = {};
  let i = 1;
  while (i < closingIndex) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }
    const topMatch = TOP_LEVEL_KEY_RE.exec(line);
    if (!topMatch) {
      i++;
      continue;
    }
    const [, key, rest] = topMatch;
    if (rest === '') {
      const nested: Record<string, string> = {};
      let j = i + 1;
      while (j < closingIndex && NESTED_LINE_RE.test(lines[j] ?? '')) {
        const nestedMatch = NESTED_KEY_RE.exec(lines[j]!);
        if (nestedMatch) {
          nested[nestedMatch[1]!] = stripQuotes(nestedMatch[2]!);
        }
        j++;
      }
      frontmatter[key!] = nested;
      i = j;
    } else {
      frontmatter[key!] = stripQuotes(rest!);
      i++;
    }
  }

  const body = lines.slice(closingIndex + 1).join('\n');
  return { frontmatter, body };
}

export function checkSkillFrontmatter(content: string, options: FrontmatterCheckOptions): Violation[] {
  const parsed = parseFrontmatterSubset(content);
  if ('error' in parsed) {
    return [{ checker: 'frontmatter', severity: 'error', message: parsed.error }];
  }

  const { frontmatter, body } = parsed;
  const violations: Violation[] = [];

  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (frontmatter[field] === undefined || frontmatter[field] === '') {
      violations.push({ checker: 'frontmatter', severity: 'error', message: `missing required frontmatter field "${field}"` });
    }
  }

  const name = frontmatter.name;
  if (typeof name === 'string' && name !== '' && name !== options.expectedName) {
    violations.push({
      checker: 'frontmatter',
      severity: 'error',
      message: `frontmatter name "${name}" does not match expected "${options.expectedName}"`,
    });
  }

  const description = frontmatter.description;
  if (typeof description === 'string' && description.length >= DESCRIPTION_MAX_LENGTH) {
    violations.push({
      checker: 'frontmatter',
      severity: 'error',
      message: `description is ${description.length} chars, must be under ${DESCRIPTION_MAX_LENGTH}`,
    });
  }

  const metadata = frontmatter.metadata;
  const hasVersion = typeof metadata === 'object' && metadata !== null && 'version' in (metadata as Record<string, unknown>);
  if (!hasVersion) {
    violations.push({ checker: 'frontmatter', severity: 'error', message: 'missing required frontmatter field "metadata.version"' });
  }

  const bodyWordCount = wordCount(body);
  if (bodyWordCount > SKILL_BODY_WORD_WARN_THRESHOLD) {
    violations.push({
      checker: 'frontmatter',
      severity: 'warn',
      message: `body is ${bodyWordCount} words, exceeds the ${SKILL_BODY_WORD_WARN_THRESHOLD}-word warn threshold (target ${SKILL_BODY_WORD_TARGET})`,
    });
  }

  return violations;
}
