import type { Profile } from './profile.ts';
import { FILLER_PHRASES, CONCEPT_SYNONYM_SETS } from './data/lexicon.ts';

// ---------------------------------------------------------------------------
// Checker registry (FR7) — consumed by src/golden-schema.ts (D14) for the
// `expected_checks[].checker` enum. Not every id below has an implementing
// function in this file: `profile-schema` is src/profile.ts's validate(),
// `golden-case-schema` is src/golden-schema.ts's validateGoldenCase(),
// `comprehension-gate` is src/comprehension-gate-checker.ts's
// checkComprehensionGate().
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
  'comprehension-gate',
  'learning-asset',
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

function sentenceUnits(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const strings: string[] = [];
      const visit = (value: unknown): void => {
        if (typeof value === 'string') strings.push(value);
        else if (Array.isArray(value)) value.forEach(visit);
        else if (typeof value === 'object' && value !== null) Object.values(value).forEach(visit);
      };
      visit(JSON.parse(trimmed));
      return strings.flatMap((value) => splitSentences(value.replace(/`[^`]*`/g, ' ')));
    } catch {
      // Not valid machine JSON; evaluate it as ordinary prose below.
    }
  }

  const sentences: string[] = [];
  let paragraph: string[] = [];
  let inFence = false;
  const flush = (): void => {
    if (paragraph.length > 0) sentences.push(...splitSentences(paragraph.join(' ').replace(/`[^`]*`/g, ' ')));
    paragraph = [];
  };

  for (const line of text.split('\n')) {
    const lineTrimmed = line.trimStart();
    if (lineTrimmed.startsWith('```')) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence || lineTrimmed.startsWith('>') || /^#{1,6}\s/.test(lineTrimmed) || /^\*\*[^*]+\*\*$/.test(lineTrimmed)) {
      flush();
      continue;
    }
    if (lineTrimmed.trim() === '') {
      flush();
      continue;
    }
    if (LIST_MARKER_PREFIX_RE.test(lineTrimmed)) {
      flush();
      sentences.push(...splitSentences(lineTrimmed.replace(LIST_MARKER_PREFIX_RE, '').replace(/`[^`]*`/g, ' ')));
      continue;
    }
    paragraph.push(lineTrimmed);
  }
  flush();
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
  const sentences = sentenceUnits(text);
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
  const prose = extractProse(text);
  for (const set of CONCEPT_SYNONYM_SETS) {
    const used = set.filter((term) => wordBoundaryRegex(term).test(prose));
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

// ---------------------------------------------------------------------------
// M5 — learning-asset structure (Layer 1, structural only; semantic quality
// stays with the Layer 2 judge)
// ---------------------------------------------------------------------------

export type AssetFormat = 'markdown' | 'html' | 'slides';

const PROFILE_APPLIED_RE = /profile applied/i;
const SLIDE_SECTION_RE = /<section\b[^>]*class=["'][^"']*\bslide\b/gi;

/** M5 phase 2: two slides is the minimum that makes a deck a deck. */
export const MIN_DECK_SLIDES = 2;

export function detectAssetFormat(asset: string): AssetFormat {
  if (new RegExp(SLIDE_SECTION_RE.source, 'i').test(asset)) return 'slides';
  return /<article\b|<h1\b|<section\b/i.test(asset) ? 'html' : 'markdown';
}

export function checkLearningAsset(asset: string, format: AssetFormat = detectAssetFormat(asset)): Violation[] {
  const violations: Violation[] = [];
  const error = (message: string): void => {
    violations.push({ checker: 'learning-asset', severity: 'error', message });
  };

  if (format === 'markdown') {
    if (!/^#\s+\S/m.test(asset)) error('markdown asset needs an H1 title line');
    if (!/^\s*(?:[-*+]\s+\S|\d+[.)]\s+\S)/m.test(asset)) error('markdown asset needs a numbered or bulleted step list');
  } else if (format === 'slides') {
    if (!/<article\b/i.test(asset)) error('slide deck needs an <article> wrapper');
    if (!/<h1\b/i.test(asset)) error('slide deck needs an <h1> deck title');

    const slides = asset.match(SLIDE_SECTION_RE) ?? [];
    if (slides.length < MIN_DECK_SLIDES) {
      error(`slide deck needs at least two slides, found ${slides.length}`);
    }
    if (splitSlides(asset).some((slide) => !/<h[1-6]\b/i.test(slide))) {
      error('every slide needs its own heading');
    }
    if (hasExternalAssets(asset)) {
      error('slide deck must not require external scripts or stylesheets');
    }
  } else {
    if (!/<article\b/i.test(asset)) error('html asset needs an <article> wrapper');
    if (!/<h1\b/i.test(asset)) error('html asset needs an <h1> title');
    if (!/<section\b/i.test(asset)) error('html asset needs at least one <section> block');
    if (hasExternalAssets(asset)) {
      error('html asset must not require external scripts or stylesheets');
    }
  }

  if (!PROFILE_APPLIED_RE.test(asset)) error('asset must end with a one-line "Profile applied" note');

  return violations;
}

function hasExternalAssets(asset: string): boolean {
  return /<script\b[^>]*\bsrc=/i.test(asset) || /<link\b[^>]*rel=["']?stylesheet/i.test(asset);
}

function splitSlides(asset: string): string[] {
  const opens = [...asset.matchAll(SLIDE_SECTION_RE)].map((match) => match.index ?? 0);
  return opens.map((start, i) => asset.slice(start, opens[i + 1] ?? asset.length));
}
