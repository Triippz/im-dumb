import type { Violation } from './checkers.ts';
import { normalizeReply } from './reference-classifier.ts';

// ---------------------------------------------------------------------------
// comprehension-gate deterministic hard-constraint checker.
// Pure, dependency-free. Structural/format enforcement only; candidate
// specificity, relevance, and repair correctness remain semantic review
// (eval/comprehension-rubric.md dimensions 1-4).
// ---------------------------------------------------------------------------

export const COMPREHENSION_GATE_CHECKER_VERSION = 'm2-v1';

export type GateAction = 'diagnose' | 'rediagnose' | 'repair' | 'direct-repair';
export type GateFormat = 'default' | 'machine';

export interface ComprehensionGateCheckOptions {
  action: GateAction;
  format: GateFormat;
  expectedCandidateCount?: 2 | 3 | 4;
}

// frozen normalized generic-label deny set.
export const GENERIC_LABEL_DENY_SET: readonly string[] = ['something', 'other', 'not sure'];

// frozen normalized bare-re-ask deny set.
export const BARE_REASK_DENY_SET: readonly string[] = [
  "what didn't you understand?",
  'what part was confusing?',
  'can you clarify?',
  'can you be more specific?',
];

// exact frozen heading full line.
export const DIAGNOSIS_HEADING = '**Likely confusion points**';

const GENERIC_LABEL_DENY_NORMALIZED = new Set(GENERIC_LABEL_DENY_SET.map((label) => normalizeReply(label)));
const BARE_REASK_DENY_NORMALIZED = new Set(BARE_REASK_DENY_SET.map((question) => normalizeReply(question)));

const MIN_CANDIDATES = 2;
const MAX_CANDIDATES = 4;

// Frozen syntax: "- **<label>**: <description>". Label and description are
// validated separately after the structural match.
const BULLET_RE = /^- \*\*([^*]*)\*\*: (.*)$/;

const LIST_PREFIX_RE = /^(?:[-*+]\s|\d+[.)]\s)/;

function violation(message: string): Violation {
  return { checker: 'comprehension-gate', severity: 'error', message };
}

function stripExclusions(text: string): string {
  const withoutFences = text.replace(/```[\s\S]*?```/g, ' ');
  const withoutBlockquotes = withoutFences
    .split('\n')
    .map((line) => (line.trim().startsWith('>') ? '' : line))
    .join('\n');
  return withoutBlockquotes.replace(/`[^`\n]*`/g, ' ');
}

export function countQuestionMarksOutsideExclusions(text: string): number {
  return (stripExclusions(text).match(/\?/g) ?? []).length;
}

function truncateForMessage(value: string, maxLength = 60): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

// ---------------------------------------------------------------------------
// repair / direct-repair, zero user-directed questions, no diagnosis
// structure requirement, identical behavior regardless of format.
// ---------------------------------------------------------------------------

function checkRepair(text: string): Violation[] {
  const count = countQuestionMarksOutsideExclusions(text);
  if (count > 0) {
    return [
      violation(
        `expected zero "?" outside fenced code, inline code, and blockquotes for repair/direct-repair, found ${count}`,
      ),
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// diagnose / rediagnose, default format frozen structure
// ---------------------------------------------------------------------------

function checkDefaultDiagnosis(text: string, expectedCandidateCount: 2 | 3 | 4 | undefined): Violation[] {
  const violations: Violation[] = [];
  const lines = text.split('\n');

  if (text === '') {
    return [violation('response is empty; expected the frozen diagnosis structure')];
  }

  const headingLine = lines[0]!;
  if (headingLine !== DIAGNOSIS_HEADING) {
    violations.push(
      violation(
        `expected the exact heading "${DIAGNOSIS_HEADING}" as the first line, found "${truncateForMessage(headingLine)}"`,
      ),
    );
  }

  let candidateRun = 0;
  while (candidateRun + 1 < lines.length && BULLET_RE.test(lines[1 + candidateRun]!)) {
    candidateRun++;
  }

  if (candidateRun < MIN_CANDIDATES) {
    violations.push(
      violation(`expected 2-4 candidate bullets directly below the heading, found ${candidateRun}`),
    );
  } else if (candidateRun > MAX_CANDIDATES) {
    violations.push(
      violation(`expected at most 4 candidate bullets directly below the heading, found ${candidateRun}`),
    );
  }

  if (expectedCandidateCount !== undefined && candidateRun !== expectedCandidateCount) {
    violations.push(violation(`expected exactly ${expectedCandidateCount} candidate bullets, found ${candidateRun}`));
  }

  for (let i = 0; i < candidateRun; i++) {
    const match = BULLET_RE.exec(lines[1 + i]!)!;
    const rawLabel = match[1]!;
    const rawDescription = match[2]!;
    const label = rawLabel.trim();
    const description = rawDescription.trim();
    if (rawLabel !== label || rawDescription !== description) {
      violations.push(violation(`candidate bullet ${i + 1} has unexpected structural whitespace`));
    }
    if (label === '') {
      violations.push(violation(`candidate bullet ${i + 1} has an empty label`));
    } else if (GENERIC_LABEL_DENY_NORMALIZED.has(normalizeReply(label))) {
      violations.push(violation(`candidate bullet ${i + 1} label "${label}" is a generic deny-listed label`));
    }
    if (description === '') {
      violations.push(violation(`candidate bullet ${i + 1} has an empty description`));
    }
  }

  const afterCandidatesIndex = 1 + candidateRun;
  const trailingLines = lines.slice(afterCandidatesIndex);
  if (trailingLines.length !== 1) {
    violations.push(
      violation(`expected exactly one final question line after the candidates, found ${trailingLines.length} trailing line(s)`),
    );
  }

  const finalLine = trailingLines.at(-1) ?? lines.at(-1)!;
  if (finalLine !== finalLine.trim()) {
    violations.push(violation('final question line has unexpected structural whitespace'));
  }
  if (LIST_PREFIX_RE.test(finalLine)) {
    violations.push(violation('final line must be a plain question, not a list item'));
  }
  if (!finalLine.endsWith('?')) {
    violations.push(violation(`final line must end with "?", found "${truncateForMessage(finalLine)}"`));
  }
  if (BARE_REASK_DENY_NORMALIZED.has(normalizeReply(finalLine))) {
    violations.push(violation(`final question "${finalLine}" matches the frozen bare-re-ask deny set`));
  }

  const questionMarkCount = countQuestionMarksOutsideExclusions(text);
  if (questionMarkCount !== 1) {
    violations.push(
      violation(
        `expected exactly one "?" outside fenced code, inline code, and blockquotes, found ${questionMarkCount}`,
      ),
    );
  }

  return violations;
}

// ---------------------------------------------------------------------------
// diagnose / rediagnose, exact machine (JSON) format
// ---------------------------------------------------------------------------

type RawCandidate = Record<string, unknown>;

function checkMachineDiagnosis(text: string, expectedCandidateCount: 2 | 3 | 4 | undefined): Violation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [violation('response is not valid JSON for machine format')];
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return [violation('machine format response must be a JSON object')];
  }

  const violations: Violation[] = [];
  const obj = parsed as Record<string, unknown>;
  const topKeys = Object.keys(obj);
  if (topKeys.length !== 2 || !topKeys.includes('candidates') || !topKeys.includes('question')) {
    violations.push(
      violation(
        `machine format object must have exactly keys "candidates" and "question", found ${JSON.stringify(topKeys)}`,
      ),
    );
  }

  let totalQuestionMarks = 0;
  const candidates = obj.candidates;
  if (!Array.isArray(candidates)) {
    violations.push(violation('"candidates" must be an array'));
  } else {
    const count = candidates.length;
    if (count < MIN_CANDIDATES || count > MAX_CANDIDATES) {
      violations.push(violation(`"candidates" must have 2-4 entries, found ${count}`));
    }
    if (expectedCandidateCount !== undefined && count !== expectedCandidateCount) {
      violations.push(violation(`expected exactly ${expectedCandidateCount} candidates, found ${count}`));
    }

    candidates.forEach((candidate: unknown, index: number) => {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
        violations.push(violation(`candidate[${index}] must be an object`));
        return;
      }
      const raw = candidate as RawCandidate;
      const keys = Object.keys(raw);
      if (keys.length !== 2 || !keys.includes('label') || !keys.includes('description')) {
        violations.push(
          violation(`candidate[${index}] must have exactly keys "label" and "description", found ${JSON.stringify(keys)}`),
        );
      }

      const { label, description } = raw;
      if (typeof label !== 'string' || label.trim() === '') {
        violations.push(violation(`candidate[${index}].label must be a non-empty string`));
      } else {
        totalQuestionMarks += (label.match(/\?/g) ?? []).length;
        if (GENERIC_LABEL_DENY_NORMALIZED.has(normalizeReply(label))) {
          violations.push(violation(`candidate[${index}].label "${label}" is a generic deny-listed label`));
        }
      }

      if (typeof description !== 'string' || description.trim() === '') {
        violations.push(violation(`candidate[${index}].description must be a non-empty string`));
      } else {
        totalQuestionMarks += (description.match(/\?/g) ?? []).length;
      }
    });
  }

  const question = obj.question;
  if (typeof question !== 'string' || question.trim() === '') {
    violations.push(violation('"question" must be a non-empty string'));
  } else {
    totalQuestionMarks += (question.match(/\?/g) ?? []).length;
    if (!question.trim().endsWith('?')) {
      violations.push(violation(`"question" must end with "?" as its final non-whitespace character, found "${truncateForMessage(question)}"`));
    }
    const questionMarkCount = (question.match(/\?/g) ?? []).length;
    if (questionMarkCount !== 1) {
      violations.push(violation(`"question" must contain exactly one "?", found ${questionMarkCount}`));
    }
    if (BARE_REASK_DENY_NORMALIZED.has(normalizeReply(question))) {
      violations.push(violation(`"question" matches the frozen bare-re-ask deny set: "${question}"`));
    }
  }

  if (totalQuestionMarks > 1) {
    violations.push(violation(`expected at most one "?" across all string values, found ${totalQuestionMarks}`));
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function checkComprehensionGate(text: string, options: ComprehensionGateCheckOptions): Violation[] {
  if (options.action === 'repair' || options.action === 'direct-repair') {
    return checkRepair(text);
  }
  return options.format === 'machine'
    ? checkMachineDiagnosis(text, options.expectedCandidateCount)
    : checkDefaultDiagnosis(text, options.expectedCandidateCount);
}
