import {
  checkAdhdStructure,
  checkForbiddenPhrases,
  checkOneTermOneConcept,
  checkOutputShapeMarkers,
  checkSentenceCap,
  type CheckerId,
  type Violation,
} from './checkers.ts';
import {
  checkComprehensionGate,
  countQuestionMarksOutsideExclusions,
  type GateAction,
} from './comprehension-gate-checker.ts';
import {
  GAP_TYPES,
  validateGoldenCase,
  type ExpectedCheck,
  type ExpectedKnownGap,
  type GoldenCase,
  type GoldenTurn,
} from './golden-schema.ts';
import { DEFAULT_PROFILE, validate, type Profile } from './profile.ts';

const GATE_ACTIONS = new Set(['diagnose', 'rediagnose', 'repair', 'direct-repair']);
const PROSE_CHECKERS = new Set<CheckerId>([
  'sentence-cap',
  'forbidden-phrases',
  'one-term-one-concept',
  'output-shape',
  'adhd-structure',
]);
const GATE_EXEMPT_CHECKERS = new Set<CheckerId>(['output-shape', 'adhd-structure']);

export type EvaluationChecker = CheckerId | 'question-count' | 'known-gaps';
export type DispatchStatus = 'invoked' | 'exempt' | 'unsupported';

export interface CheckerEvaluation {
  checker: EvaluationChecker;
  status: DispatchStatus;
  expected?: ExpectedCheck['expect'];
  violations: Violation[];
  errors: string[];
  pass: boolean;
  exemption?: string;
}

export interface GoldenPairEvaluation {
  pairIndex: number;
  userIndex: number;
  assistantIndex: number;
  expectedAction: GoldenTurn['expected_action'];
  checks: CheckerEvaluation[];
  invocationCounts: Record<string, number>;
  expectationDispatchCounts: Record<string, number>;
  exemptionCounts: Record<string, number>;
  errors: string[];
  pass: boolean;
}

export interface GoldenTurnEvaluationReport {
  caseId?: string;
  valid: boolean;
  pairs: GoldenPairEvaluation[];
  invocationCounts: Record<string, number>;
  expectationDispatchCounts: Record<string, number>;
  exemptionCounts: Record<string, number>;
  errors: string[];
  pass: boolean;
}

export interface GoldenTurnEvaluationOptions {
  actualKnownGapsByPair?: Readonly<Record<number, unknown>>;
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function mergedProfile(partial: Record<string, unknown>): { profile?: Profile; errors: string[] } {
  const raw = { ...DEFAULT_PROFILE, ...partial };
  const checked = validate(raw, 'save');
  return checked.errors.length === 0 ? { profile: checked.profile, errors: [] } : { errors: checked.errors };
}

function runProseChecker(checker: CheckerId, text: string, profile: Profile): Violation[] {
  switch (checker) {
    case 'sentence-cap': return checkSentenceCap(text, profile);
    case 'forbidden-phrases': return checkForbiddenPhrases(text, profile);
    case 'one-term-one-concept': return checkOneTermOneConcept(text);
    case 'output-shape': return checkOutputShapeMarkers(text, profile);
    case 'adhd-structure': return checkAdhdStructure(text, profile);
    default: return [];
  }
}

function expectationErrors(checker: string, expected: ExpectedCheck['expect'], violations: Violation[]): string[] {
  const errors = violations.filter((item) => item.severity === 'error').length;
  const warnings = violations.filter((item) => item.severity === 'warn').length;
  // Frozen expectation semantics: pass=no violations, fail=an error, warn=warnings only.
  const matched = expected === 'pass'
    ? violations.length === 0
    : expected === 'fail'
      ? errors > 0
      : warnings > 0 && errors === 0;
  return matched ? [] : [`${checker} expected ${expected}, found ${errors} error(s) and ${warnings} warning(s)`];
}

function unsupported(check: ExpectedCheck): CheckerEvaluation {
  const message = `checker "${check.checker}" is not supported for turns evaluation`;
  return {
    checker: check.checker,
    status: 'unsupported',
    expected: check.expect,
    violations: [],
    errors: [message],
    pass: false,
  };
}

interface ActualSnapshotValidation {
  recognized: ExpectedKnownGap[];
  errors: string[];
}

const INVALID_GAP_TYPE_CHARACTER_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateActualKnownGaps(actual: unknown): ActualSnapshotValidation {
  if (!Array.isArray(actual)) return { recognized: [], errors: ['actual known-gap snapshot must be an array'] };

  const recognized: ExpectedKnownGap[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  actual.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      errors.push(`actual known-gap snapshot[${index}] must be an object`);
      return;
    }
    const keys = Reflect.ownKeys(entry);
    if (keys.length !== 2 || !keys.includes('type') || !keys.includes('confidence')) {
      errors.push(`actual known-gap snapshot[${index}] must have exactly keys "type" and "confidence"`);
      return;
    }
    const { type, confidence } = entry;
    const typeValid = typeof type === 'string' && type.trim() !== '' &&
      [...type].length <= 40 && !INVALID_GAP_TYPE_CHARACTER_RE.test(type);
    if (!typeValid) {
      errors.push(`actual known-gap snapshot[${index}].type must be a non-empty clean string of at most 40 characters`);
      return;
    }
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      errors.push(`actual known-gap snapshot[${index}].confidence must be finite and in [0,1]`);
      return;
    }
    if (!(GAP_TYPES as readonly string[]).includes(type)) return;
    if (seen.has(type)) {
      errors.push(`actual known-gap snapshot has duplicate recognized type "${type}"`);
      return;
    }
    seen.add(type);
    recognized.push({ type: type as ExpectedKnownGap['type'], confidence });
  });
  recognized.sort((a, b) => GAP_TYPES.indexOf(a.type) - GAP_TYPES.indexOf(b.type));
  return { recognized, errors };
}

function compareKnownGaps(expected: ExpectedKnownGap[], actual: ExpectedKnownGap[]): string[] {
  const wanted = expected.map((gap) => ({ ...gap }));
  if (actual.length !== wanted.length || wanted.some((gap, index) =>
    gap.type !== actual[index]?.type || gap.confidence !== actual[index]?.confidence)) {
    return [`known-gap state mismatch: expected ${JSON.stringify(wanted)}, found ${JSON.stringify(actual)}`];
  }
  return [];
}

function emptyReport(caseId: string | undefined, errors: string[], valid = false): GoldenTurnEvaluationReport {
  return {
    caseId,
    valid,
    pairs: [],
    invocationCounts: {},
    expectationDispatchCounts: {},
    exemptionCounts: {},
    errors,
    pass: false,
  };
}

export function evaluateGoldenTurns(rawCase: unknown, options: GoldenTurnEvaluationOptions = {}): GoldenTurnEvaluationReport {
  const validation = validateGoldenCase(rawCase);
  const caseId = typeof rawCase === 'object' && rawCase !== null && 'id' in rawCase && typeof rawCase.id === 'string'
    ? rawCase.id
    : undefined;
  if (!validation.valid) return emptyReport(caseId, validation.errors);

  const goldenCase = rawCase as GoldenCase;
  if (goldenCase.turns === undefined) {
    return emptyReport(goldenCase.id, ['golden-turn evaluator requires a turns-only case']);
  }

  const duplicateChecks = goldenCase.expected_checks
    .map((check) => check.checker)
    .filter((checker, index, all) => all.indexOf(checker) !== index);
  if (duplicateChecks.length > 0) {
    return emptyReport(goldenCase.id, [`duplicate expected checker declaration(s): ${[...new Set(duplicateChecks)].join(', ')}`]);
  }

  const profileResult = mergedProfile(goldenCase.profile);
  if (profileResult.profile === undefined) {
    return emptyReport(goldenCase.id, profileResult.errors.map((error) => `invalid merged profile: ${error}`));
  }
  const profile = profileResult.profile;
  const initialState = validateActualKnownGaps(profile.known_gap_types);
  if (initialState.errors.length > 0) {
    return emptyReport(goldenCase.id, initialState.errors.map((error) => `invalid merged profile known gaps: ${error}`));
  }

  const suppliedSnapshots = new Map<number, ExpectedKnownGap[]>();
  const optionErrors: string[] = [];
  const rawSnapshots = options.actualKnownGapsByPair;
  if (rawSnapshots !== undefined) {
    if (!isPlainObject(rawSnapshots)) {
      optionErrors.push('"actualKnownGapsByPair" must be an object keyed by pair index');
    } else {
      for (const rawKey of Reflect.ownKeys(rawSnapshots)) {
        if (typeof rawKey !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(rawKey) || !Number.isSafeInteger(Number(rawKey))) {
          optionErrors.push(`actual known-gap observation key "${String(rawKey)}" must be a non-negative integer pair index`);
          continue;
        }
        const key = rawKey;
        const pairIndex = Number(key);
        const user = goldenCase.turns[pairIndex * 2];
        if (user === undefined) {
          optionErrors.push(`actual known-gap observation key "${key}" is outside the case pair range`);
          continue;
        }
        if (user.expected_known_gaps === undefined) {
          optionErrors.push(`actual known-gap observation key "${key}" targets a pair without expected_known_gaps`);
          continue;
        }
        const checked = validateActualKnownGaps(rawSnapshots[pairIndex]);
        optionErrors.push(...checked.errors.map((error) => `pair ${pairIndex}: ${error}`));
        if (checked.errors.length === 0) suppliedSnapshots.set(pairIndex, checked.recognized);
      }
    }
  }
  if (optionErrors.length > 0) return emptyReport(goldenCase.id, optionErrors, true);

  let carriedState = initialState.recognized;
  const pairs: GoldenPairEvaluation[] = [];
  const invocationCounts: Record<string, number> = {};
  const expectationDispatchCounts: Record<string, number> = {};
  const exemptionCounts: Record<string, number> = {};

  for (let userIndex = 0; userIndex < goldenCase.turns.length; userIndex += 2) {
    const user = goldenCase.turns[userIndex]!;
    const assistantIndex = userIndex + 1;
    const assistant = goldenCase.turns[assistantIndex]!;
    const pairIndex = userIndex / 2;
    const gateAction = GATE_ACTIONS.has(user.expected_action!);
    const checks: CheckerEvaluation[] = [];
    const pairInvocations: Record<string, number> = {};
    const pairDispatches: Record<string, number> = {};
    const pairExemptions: Record<string, number> = {};

    for (const expectedCheck of goldenCase.expected_checks) {
      increment(pairDispatches, expectedCheck.checker);
      increment(expectationDispatchCounts, expectedCheck.checker);

      if (PROSE_CHECKERS.has(expectedCheck.checker)) {
        if ((gateAction || user.expected_format === 'machine') && GATE_EXEMPT_CHECKERS.has(expectedCheck.checker)) {
          increment(pairExemptions, expectedCheck.checker);
          increment(exemptionCounts, expectedCheck.checker);
          checks.push({
            checker: expectedCheck.checker,
            status: 'exempt',
            expected: expectedCheck.expect,
            violations: [],
            errors: [],
            pass: true,
            exemption: `${gateAction ? `action "${user.expected_action}"` : 'machine format'} is exempt from ${expectedCheck.checker}`,
          });
          continue;
        }
        const violations = runProseChecker(expectedCheck.checker, assistant.content, profile);
        const errors = expectationErrors(expectedCheck.checker, expectedCheck.expect, violations);
        increment(pairInvocations, expectedCheck.checker);
        increment(invocationCounts, expectedCheck.checker);
        checks.push({
          checker: expectedCheck.checker,
          status: 'invoked',
          expected: expectedCheck.expect,
          violations,
          errors,
          pass: errors.length === 0,
        });
        continue;
      }

      if (expectedCheck.checker !== 'comprehension-gate') checks.push(unsupported(expectedCheck));
    }

    const declaredGate = goldenCase.expected_checks.find((check) => check.checker === 'comprehension-gate');
    if (gateAction) {
      const violations = checkComprehensionGate(assistant.content, {
        action: user.expected_action as GateAction,
        format: user.expected_format!,
        expectedCandidateCount: user.expected_candidate_count,
      });
      const errors = declaredGate === undefined
        ? violations.filter((item) => item.severity === 'error').map((item) => item.message)
        : expectationErrors('comprehension-gate', declaredGate.expect, violations);
      increment(pairInvocations, 'comprehension-gate');
      increment(invocationCounts, 'comprehension-gate');
      checks.push({
        checker: 'comprehension-gate',
        status: 'invoked',
        expected: declaredGate?.expect,
        violations,
        errors,
        pass: errors.length === 0,
      });
    } else if (declaredGate !== undefined) {
      increment(pairExemptions, 'comprehension-gate');
      increment(exemptionCounts, 'comprehension-gate');
      checks.push({
        checker: 'comprehension-gate',
        status: 'exempt',
        expected: declaredGate.expect,
        violations: [],
        errors: [],
        pass: true,
        exemption: `action "${user.expected_action}" does not use the comprehension gate`,
      });
    }

    if (!gateAction) {
      const actualCount = countQuestionMarksOutsideExclusions(assistant.content);
      const expectedCount = user.expected_question_count!;
      const errors = actualCount === expectedCount
        ? []
        : [`question-count expected ${expectedCount}, found ${actualCount} outside fenced code, inline code, and blockquotes`];
      increment(pairInvocations, 'question-count');
      increment(invocationCounts, 'question-count');
      checks.push({ checker: 'question-count', status: 'invoked', violations: [], errors, pass: errors.length === 0 });
    }

    if (user.expected_known_gaps !== undefined) {
      const supplied = suppliedSnapshots.get(pairIndex);
      const errors = user.expected_action === 'record-resolution' && supplied === undefined
        ? [`record-resolution pair ${pairIndex} requires an external actual known-gap snapshot`]
        : compareKnownGaps(user.expected_known_gaps, supplied ?? carriedState);
      if (supplied !== undefined) carriedState = supplied.map((gap) => ({ ...gap }));
      increment(pairInvocations, 'known-gaps');
      increment(invocationCounts, 'known-gaps');
      checks.push({ checker: 'known-gaps', status: 'invoked', violations: [], errors, pass: errors.length === 0 });
    }

    const errors = checks.flatMap((check) => check.errors.map((error) => `${check.checker}: ${error}`));
    pairs.push({
      pairIndex,
      userIndex,
      assistantIndex,
      expectedAction: user.expected_action,
      checks,
      invocationCounts: pairInvocations,
      expectationDispatchCounts: pairDispatches,
      exemptionCounts: pairExemptions,
      errors,
      pass: errors.length === 0,
    });
  }

  const errors = pairs.flatMap((pair) => pair.errors.map((error) => `pair ${pair.pairIndex}: ${error}`));
  return {
    caseId: goldenCase.id,
    valid: true,
    pairs,
    invocationCounts,
    expectationDispatchCounts,
    exemptionCounts,
    errors,
    pass: errors.length === 0,
  };
}
