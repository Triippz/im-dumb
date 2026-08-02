import { createHash } from 'node:crypto';

import { CHECKER_IDS, type CheckerId } from './checkers.ts';

// ---------------------------------------------------------------------------
// golden case schema (hand-rolled validator, no ajv)
// ---------------------------------------------------------------------------

// Prompt-shaped categories carry a single prompt; gate categories carry turns.
export const GOLDEN_CATEGORIES = [
  'persona-baseline',
  'jargon-decomposition',
  'adhd-pair',
  'adversarial',
  'comprehension-gate',
  'profile-adaptation',
  'learning-asset',
] as const;
export type GoldenCategory = (typeof GOLDEN_CATEGORIES)[number];

export const TURNS_ONLY_CATEGORIES = ['comprehension-gate', 'profile-adaptation'] as const;
export type TurnsOnlyCategory = (typeof TURNS_ONLY_CATEGORIES)[number];

export const PROMPT_ONLY_CATEGORIES = ['persona-baseline', 'jargon-decomposition', 'adhd-pair', 'adversarial', 'learning-asset'] as const;
export type PromptOnlyCategory = (typeof PROMPT_ONLY_CATEGORIES)[number];

export const EXPECTED_RESULTS = ['pass', 'fail', 'warn'] as const;
export type ExpectedResult = (typeof EXPECTED_RESULTS)[number];

export interface ExpectedCheck {
  checker: CheckerId;
  expect: ExpectedResult;
}

// closed runtime-write gap taxonomy.
export const GAP_TYPES = ['term', 'step', 'assumption', 'framing'] as const;
export type GapType = (typeof GAP_TYPES)[number];

// dispatcher actions a golden turn can expect.
export const EXPECTED_ACTIONS = [
  'answer',
  'diagnose',
  'repair',
  'direct-repair',
  'rediagnose',
  'record-resolution',
] as const;
export type ExpectedAction = (typeof EXPECTED_ACTIONS)[number];

export const EXPECTED_FORMATS = ['default', 'machine'] as const;
export type ExpectedFormat = (typeof EXPECTED_FORMATS)[number];

// confidence is finite, in [0,1], and a quarter step.
const QUARTER_STEP_CONFIDENCES = new Set<number>([0, 0.25, 0.5, 0.75, 1]);

export interface ExpectedKnownGap {
  type: GapType;
  confidence: number;
}

export interface GoldenTurn {
  role: 'user' | 'assistant';
  content: string;
  // The fields below are allowed only on user turns and describe the
  // immediately following assistant turn.
  expected_action?: ExpectedAction;
  expected_gap_type?: GapType;
  expected_question_count?: 0 | 1;
  expected_candidate_count?: 2 | 3 | 4;
  expected_known_gaps?: ExpectedKnownGap[];
  expected_format?: ExpectedFormat;
}

export interface GoldenCase {
  id: string;
  category: GoldenCategory;
  // Exactly one of "prompt" (v1, prompt-only categories) or "turns" (v2,
  // turns-only categories) is present, enforced by validateGoldenCase().
  prompt?: string;
  turns?: GoldenTurn[];
  profile: Record<string, unknown>;
  reference_facts: string[];
  must_preserve: string[];
  expected_checks: ExpectedCheck[];
  // pair_id is forbidden when turns is present.
  pair_id?: string;
}

export interface GoldenValidationResult {
  valid: boolean;
  errors: string[];
}

const MAX_STRING_ARRAY_ITEMS = 20;
const MAX_STRING_ARRAY_ITEM_LENGTH = 200;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateStringArrayField(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`"${field}" must be an array of strings`);
    return;
  }
  if (value.length > MAX_STRING_ARRAY_ITEMS) {
    errors.push(`"${field}" must have at most ${MAX_STRING_ARRAY_ITEMS} items, got ${value.length}`);
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string') {
      errors.push(`"${field}[${index}]" must be a string`);
    } else if (item.length > MAX_STRING_ARRAY_ITEM_LENGTH) {
      errors.push(`"${field}[${index}]" must be at most ${MAX_STRING_ARRAY_ITEM_LENGTH} chars, got ${item.length}`);
    }
  });
}

export function validateGoldenCase(raw: unknown): GoldenValidationResult {
  if (!isPlainObject(raw)) {
    return { valid: false, errors: ['golden case must be an object'] };
  }

  const errors: string[] = [];

  if (typeof raw.id !== 'string' || raw.id.trim() === '') {
    errors.push('"id" must be a non-empty string');
  }

  if (typeof raw.category !== 'string' || !(GOLDEN_CATEGORIES as readonly string[]).includes(raw.category)) {
    errors.push(`"category" must be one of ${GOLDEN_CATEGORIES.join(', ')}`);
  }
  const category =
    typeof raw.category === 'string' && (GOLDEN_CATEGORIES as readonly string[]).includes(raw.category)
      ? (raw.category as GoldenCategory)
      : undefined;

  const hasPrompt = raw.prompt !== undefined;
  const hasTurns = raw.turns !== undefined;

  if (hasPrompt && hasTurns) {
    errors.push('a golden case must have exactly one of "prompt" or "turns", not both');
  } else if (!hasPrompt && !hasTurns) {
    errors.push('a golden case must have exactly one of "prompt" or "turns"');
  } else if (hasPrompt) {
    if (typeof raw.prompt !== 'string' || raw.prompt.trim() === '') {
      errors.push('"prompt" must be a non-empty string');
    }
    if (category !== undefined && !(PROMPT_ONLY_CATEGORIES as readonly string[]).includes(category)) {
      errors.push(`category "${category}" requires "turns", not "prompt"`);
    }
  } else {
    if (category !== undefined && !(TURNS_ONLY_CATEGORIES as readonly string[]).includes(category)) {
      errors.push(`category "${category}" requires "prompt", not "turns"`);
    }
    validateTurns(raw.turns, errors);
  }

  if (!isPlainObject(raw.profile)) {
    errors.push('"profile" must be an object');
  }

  validateStringArrayField(raw.reference_facts, 'reference_facts', errors);
  validateStringArrayField(raw.must_preserve, 'must_preserve', errors);

  if (!Array.isArray(raw.expected_checks) || raw.expected_checks.length === 0) {
    errors.push('"expected_checks" must be a non-empty array');
  } else {
    raw.expected_checks.forEach((entry, index) => {
      if (!isPlainObject(entry)) {
        errors.push(`"expected_checks[${index}]" must be an object`);
        return;
      }
      if (typeof entry.checker !== 'string' || !(CHECKER_IDS as readonly string[]).includes(entry.checker)) {
        errors.push(`"expected_checks[${index}].checker" must be one of ${CHECKER_IDS.join(', ')}`);
      }
      if (typeof entry.expect !== 'string' || !(EXPECTED_RESULTS as readonly string[]).includes(entry.expect)) {
        errors.push(`"expected_checks[${index}].expect" must be one of ${EXPECTED_RESULTS.join(', ')}`);
      }
    });
  }

  if (raw.pair_id !== undefined) {
    if (hasTurns) {
      errors.push('"pair_id" is forbidden when "turns" is present');
    } else if (typeof raw.pair_id !== 'string' || raw.pair_id.trim() === '') {
      errors.push('"pair_id" must be a non-empty string when present');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// turns[] shape, strict alternation, action matrix
// ---------------------------------------------------------------------------

const MIN_TURNS = 2;
const MAX_TURNS = 8;

const TURN_EXPECTATION_FIELDS = [
  'expected_action',
  'expected_gap_type',
  'expected_question_count',
  'expected_candidate_count',
  'expected_known_gaps',
  'expected_format',
] as const;

const TURN_ALLOWED_FIELDS = new Set<string>(['role', 'content', ...TURN_EXPECTATION_FIELDS]);

// action matrix.
const QUESTION_COUNT_BY_ACTION: Record<ExpectedAction, 0 | 1> = {
  answer: 0,
  diagnose: 1,
  repair: 0,
  'direct-repair': 0,
  rediagnose: 1,
  'record-resolution': 0,
};

const CANDIDATE_COUNT_REQUIRED_ACTIONS = new Set<ExpectedAction>(['diagnose', 'rediagnose']);
const GAP_TYPE_REQUIRED_ACTIONS = new Set<ExpectedAction>(['repair', 'direct-repair', 'record-resolution']);
const KNOWN_GAPS_REQUIRED_ACTIONS = new Set<ExpectedAction>(['record-resolution']);

function validateTurns(rawTurns: unknown, errors: string[]): void {
  if (!Array.isArray(rawTurns)) {
    errors.push('"turns" must be an array');
    return;
  }

  if (rawTurns.length < MIN_TURNS || rawTurns.length > MAX_TURNS) {
    errors.push(`"turns" must have between ${MIN_TURNS} and ${MAX_TURNS} entries, got ${rawTurns.length}`);
  }
  if (rawTurns.length % 2 !== 0) {
    errors.push('"turns" must have an even number of entries');
  }

  rawTurns.forEach((rawTurn, index) => {
    if (!isPlainObject(rawTurn)) {
      errors.push(`"turns[${index}]" must be an object`);
      return;
    }

    for (const key of Object.keys(rawTurn)) {
      if (!TURN_ALLOWED_FIELDS.has(key)) {
        errors.push(`"turns[${index}]" has unknown field "${key}"`);
      }
    }

    // Strict alternation, user-first, assistant-last: even indices are user
    // turns, odd indices are assistant turns (only self-consistent when the
    // overall length is even, checked above).
    const expectedRole = index % 2 === 0 ? 'user' : 'assistant';
    if (rawTurn.role !== 'user' && rawTurn.role !== 'assistant') {
      errors.push(`"turns[${index}].role" must be "user" or "assistant"`);
    } else if (rawTurn.role !== expectedRole) {
      errors.push(`"turns[${index}].role" must be "${expectedRole}" (turns strictly alternate, starting with user)`);
    }

    if (typeof rawTurn.content !== 'string' || rawTurn.content.trim() === '') {
      errors.push(`"turns[${index}].content" must be a non-empty string`);
    }

    if (rawTurn.role === 'assistant') {
      for (const field of TURN_EXPECTATION_FIELDS) {
        if (rawTurn[field] !== undefined) {
          errors.push(`"turns[${index}]" is an assistant turn and must not set "${field}"`);
        }
      }
      return;
    }

    if (rawTurn.role !== 'user') return;

    let action: ExpectedAction | undefined;
    if (typeof rawTurn.expected_action !== 'string' || !(EXPECTED_ACTIONS as readonly string[]).includes(rawTurn.expected_action)) {
      errors.push(`"turns[${index}].expected_action" must be one of ${EXPECTED_ACTIONS.join(', ')}`);
    } else {
      action = rawTurn.expected_action as ExpectedAction;
    }

    if (typeof rawTurn.expected_format !== 'string' || !(EXPECTED_FORMATS as readonly string[]).includes(rawTurn.expected_format)) {
      errors.push(`"turns[${index}].expected_format" must be one of ${EXPECTED_FORMATS.join(', ')}`);
    }

    if (rawTurn.expected_question_count !== 0 && rawTurn.expected_question_count !== 1) {
      errors.push(`"turns[${index}].expected_question_count" must be 0 or 1`);
    } else if (action !== undefined && rawTurn.expected_question_count !== QUESTION_COUNT_BY_ACTION[action]) {
      errors.push(
        `"turns[${index}].expected_question_count" must be ${QUESTION_COUNT_BY_ACTION[action]} for action "${action}"`,
      );
    }

    const hasCandidateCount = rawTurn.expected_candidate_count !== undefined;
    const candidateInRange =
      rawTurn.expected_candidate_count === 2 || rawTurn.expected_candidate_count === 3 || rawTurn.expected_candidate_count === 4;
    if (action !== undefined && CANDIDATE_COUNT_REQUIRED_ACTIONS.has(action)) {
      if (!candidateInRange) {
        errors.push(`"turns[${index}].expected_candidate_count" must be 2, 3, or 4 for action "${action}"`);
      }
    } else if (action !== undefined && hasCandidateCount) {
      errors.push(`"turns[${index}].expected_candidate_count" is forbidden for action "${action}"`);
    } else if (action === undefined && hasCandidateCount && !candidateInRange) {
      errors.push(`"turns[${index}].expected_candidate_count" must be 2, 3, or 4`);
    }

    const hasGapType = rawTurn.expected_gap_type !== undefined;
    const gapTypeValid = typeof rawTurn.expected_gap_type === 'string' && (GAP_TYPES as readonly string[]).includes(rawTurn.expected_gap_type);
    if (action !== undefined && GAP_TYPE_REQUIRED_ACTIONS.has(action)) {
      if (!gapTypeValid) {
        errors.push(`"turns[${index}].expected_gap_type" must be one of ${GAP_TYPES.join(', ')} for action "${action}"`);
      }
    } else if (action !== undefined && hasGapType) {
      errors.push(`"turns[${index}].expected_gap_type" is forbidden for action "${action}"`);
    } else if (action === undefined && hasGapType && !gapTypeValid) {
      errors.push(`"turns[${index}].expected_gap_type" must be one of ${GAP_TYPES.join(', ')}`);
    }

    if (rawTurn.expected_known_gaps !== undefined) {
      validateKnownGaps(rawTurn.expected_known_gaps, index, errors);
    } else if (action !== undefined && KNOWN_GAPS_REQUIRED_ACTIONS.has(action)) {
      errors.push(`"turns[${index}].expected_known_gaps" is required for action "${action}"`);
    }
  });
}

function validateKnownGaps(rawGaps: unknown, turnIndex: number, errors: string[]): void {
  if (!Array.isArray(rawGaps)) {
    errors.push(`"turns[${turnIndex}].expected_known_gaps" must be an array`);
    return;
  }

  const seenTypes: GapType[] = [];
  rawGaps.forEach((entry, gapIndex) => {
    if (!isPlainObject(entry)) {
      errors.push(`"turns[${turnIndex}].expected_known_gaps[${gapIndex}]" must be an object`);
      return;
    }

    for (const key of Object.keys(entry)) {
      if (key !== 'type' && key !== 'confidence') {
        errors.push(`"turns[${turnIndex}].expected_known_gaps[${gapIndex}]" has unknown field "${key}"`);
      }
    }

    let type: GapType | undefined;
    if (typeof entry.type !== 'string' || !(GAP_TYPES as readonly string[]).includes(entry.type)) {
      errors.push(`"turns[${turnIndex}].expected_known_gaps[${gapIndex}].type" must be one of ${GAP_TYPES.join(', ')}`);
    } else {
      type = entry.type as GapType;
    }

    if (typeof entry.confidence !== 'number' || !QUARTER_STEP_CONFIDENCES.has(entry.confidence)) {
      errors.push(
        `"turns[${turnIndex}].expected_known_gaps[${gapIndex}].confidence" must be finite, in [0,1], and a quarter step (one of ${[
          ...QUARTER_STEP_CONFIDENCES,
        ].join(', ')})`,
      );
    }

    if (type !== undefined) {
      if (seenTypes.includes(type)) {
        errors.push(`"turns[${turnIndex}].expected_known_gaps" has duplicate type "${type}"`);
      }
      seenTypes.push(type);
    }
  });

  if (seenTypes.length === rawGaps.length) {
    const sortedTypes = [...seenTypes].sort((a, b) => GAP_TYPES.indexOf(a) - GAP_TYPES.indexOf(b));
    const isSorted = seenTypes.every((type, index) => type === sortedTypes[index]);
    if (!isSorted) {
      errors.push(`"turns[${turnIndex}].expected_known_gaps" must be sorted by type in taxonomy order (${GAP_TYPES.join(', ')})`);
    }
  }
}

// ---------------------------------------------------------------------------
// pair invariant + case-id uniqueness across a validated set
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

export function validateGoldenCaseSet(cases: GoldenCase[]): GoldenValidationResult {
  const errors: string[] = [];

  const seenIds = new Set<string>();
  for (const c of cases) {
    if (seenIds.has(c.id)) {
      errors.push(`duplicate case id "${c.id}"`);
    }
    seenIds.add(c.id);
  }

  const byPairId = new Map<string, GoldenCase[]>();
  for (const c of cases) {
    if (c.pair_id === undefined) continue;
    const group = byPairId.get(c.pair_id) ?? [];
    group.push(c);
    byPairId.set(c.pair_id, group);
  }

  for (const [pairId, group] of byPairId) {
    if (group.length !== 2) {
      errors.push(`pair_id "${pairId}" must name exactly 2 cases, found ${group.length}`);
      continue;
    }
    const [a, b] = group as [GoldenCase, GoldenCase];
    if (a.prompt !== b.prompt) {
      errors.push(`pair_id "${pairId}" cases must share an identical prompt`);
    }
    const { adhd_mode: adhdA, ...restA } = a.profile;
    const { adhd_mode: adhdB, ...restB } = b.profile;
    if (!deepEqual(restA, restB)) {
      errors.push(`pair_id "${pairId}" cases must share an identical profile except adhd_mode`);
    }
    if (adhdA === adhdB) {
      errors.push(`pair_id "${pairId}" cases must differ on adhd_mode`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// manifest: sorted case ids + per-file SHA-256, generator + verifier
// ---------------------------------------------------------------------------

export interface GoldenCaseFile {
  id: string;
  path: string;
  contents: string;
}

export interface GoldenManifestEntry {
  id: string;
  path: string;
  sha256: string;
}

export interface GoldenManifest {
  cases: GoldenManifestEntry[];
}

export interface ManifestDriftResult {
  drifted: boolean;
  issues: string[];
}

export function generateManifest(files: GoldenCaseFile[]): GoldenManifest {
  const cases = files
    .map((file) => ({ id: file.id, path: file.path, sha256: createHash('sha256').update(file.contents, 'utf8').digest('hex') }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { cases };
}

export function verifyManifest(manifest: GoldenManifest, files: GoldenCaseFile[]): ManifestDriftResult {
  const issues: string[] = [];
  const current = generateManifest(files);

  const manifestById = new Map(manifest.cases.map((entry) => [entry.id, entry]));
  const currentById = new Map(current.cases.map((entry) => [entry.id, entry]));

  for (const [id, entry] of currentById) {
    const recorded = manifestById.get(id);
    if (!recorded) {
      issues.push(`case "${id}" is present on disk but missing from the manifest`);
    } else if (recorded.sha256 !== entry.sha256) {
      issues.push(`case "${id}" content hash drifted (manifest ${recorded.sha256}, on-disk ${entry.sha256})`);
    } else if (recorded.path !== entry.path) {
      issues.push(`case "${id}" path drifted (manifest ${recorded.path}, on-disk ${entry.path})`);
    }
  }

  for (const id of manifestById.keys()) {
    if (!currentById.has(id)) {
      issues.push(`case "${id}" is recorded in the manifest but missing on disk`);
    }
  }

  return { drifted: issues.length > 0, issues };
}
