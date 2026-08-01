import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runChecks } from './check-cli.ts';
import type { Violation } from './checkers.ts';
import {
  JUDGE_DIMENSIONS,
  MAX_JUDGE_TRIALS,
  MIN_JUDGE_TRIALS,
  aggregateCaseTrials,
  type CaseAggregate,
  type TrialVerdict,
} from './eval-aggregate.ts';
import { validateGoldenCase, type GoldenCase } from './golden-schema.ts';
import {
  JUDGE_TEMPERATURE,
  createHttpJudgeClient,
  parseJudgePin,
  type JudgeClient,
  type JudgePin,
  type JudgeVerdict,
} from './judge-client.ts';
import { DEFAULT_PROFILE, validate, type Profile } from './profile.ts';
import {
  loadSmokeManifest,
  loadSmokeQuarantine,
  resolveBlockingCaseIds,
  validateSmokeCaseIds,
} from './smoke-manifest.ts';
import {
  AGGREGATE_CEILING_PERCENT,
  PER_CASE_CEILING_PERCENT,
  countCodePoints,
  hashDatasetManifest,
  overheadPercent,
  validateCapture,
  type CaseOverhead,
  type TokenOverheadReport,
} from './token-overhead.ts';

export interface EvalRunnerArgs {
  dryRun: boolean;
  json: boolean;
  smokeManifest: string;
  smokeQuarantine: string;
  baselinesDir: string;
  goldenDir: string;
  repoRoot: string;
  skillVersion: string;
  trialsPerCase: number;
  judgeClient?: JudgeClient;
  judgePin?: JudgePin;
  env?: Record<string, string | undefined>;
}

export type CandidateStatus = 'present' | 'missing';

export interface CaseJudgeResult {
  trialCount: number;
  overallPasses: number;
  overallRate: number;
  dimensions: CaseAggregate['dimensions'];
  passed: boolean;
  reason?: string;
}

export interface CaseSmokeResult {
  caseId: string;
  candidateStatus: CandidateStatus;
  layer1ErrorCount: number;
  layer1WarnCount: number;
  quarantined: boolean;
  layer1Violations?: Violation[];
  judge: CaseJudgeResult | null;
}

export type JudgeArtifactMeta =
  | { status: 'skipped' }
  | {
      status: 'ran';
      modelId: string;
      modelVersion: string;
      temperature: typeof JUDGE_TEMPERATURE;
      trialsPerCase: number;
    };

export interface EvalArtifact {
  mode: 'dry-run' | 'live';
  skillVersion: string;
  datasetHash: string;
  judge: JudgeArtifactMeta;
  blockingCaseIds: string[];
  failedBlockingCaseIds: string[];
  cases: CaseSmokeResult[];
  /** Gate 3 signal for smoke ids that have both baseline+candidate captures. */
  tokenOverhead: TokenOverheadReport | null;
}

export interface EvalSmokeResult {
  exitCode: number;
  artifact: EvalArtifact;
  error?: string;
}

const DEFAULT_SKILL_VERSION = '0.2.0';

function defaultRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function emptyDimensions(): CaseAggregate['dimensions'] {
  return Object.fromEntries(
    JUDGE_DIMENSIONS.map((dimension) => [dimension, { passes: 0, trials: 0, rate: 0 }]),
  ) as CaseAggregate['dimensions'];
}

function failedJudge(reason: string): CaseJudgeResult {
  return {
    trialCount: 0,
    overallPasses: 0,
    overallRate: 0,
    dimensions: emptyDimensions(),
    passed: false,
    reason,
  };
}

export function parseEvalRunnerArgs(argv: string[], repoRoot = defaultRepoRoot()): EvalRunnerArgs {
  let dryRun = true;
  let json = false;
  let smokeManifest = path.join(repoRoot, 'eval/smoke-manifest.json');
  let smokeQuarantine = path.join(repoRoot, 'eval/smoke-quarantine.json');
  let baselinesDir = path.join(repoRoot, 'eval/baselines');
  let goldenDir = path.join(repoRoot, 'eval/golden/cases');
  let skillVersion = DEFAULT_SKILL_VERSION;
  let trialsPerCase = MIN_JUDGE_TRIALS;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--live') dryRun = false;
    else if (arg === '--json') json = true;
    else if (arg === '--repo-root') {
      const value = argv[++i];
      if (!value) throw new Error('--repo-root requires a path');
      repoRoot = path.resolve(value);
      smokeManifest = path.join(repoRoot, 'eval/smoke-manifest.json');
      smokeQuarantine = path.join(repoRoot, 'eval/smoke-quarantine.json');
      baselinesDir = path.join(repoRoot, 'eval/baselines');
      goldenDir = path.join(repoRoot, 'eval/golden/cases');
    } else if (arg === '--skill-version') {
      const value = argv[++i];
      if (!value) throw new Error('--skill-version requires a value');
      skillVersion = value;
    } else if (arg === '--trials') {
      const value = argv[++i];
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < MIN_JUDGE_TRIALS || parsed > MAX_JUDGE_TRIALS) {
        throw new Error(`--trials must be an integer ${MIN_JUDGE_TRIALS}–${MAX_JUDGE_TRIALS}`);
      }
      trialsPerCase = parsed;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return {
    dryRun,
    json,
    smokeManifest,
    smokeQuarantine,
    baselinesDir,
    goldenDir,
    repoRoot,
    skillVersion,
    trialsPerCase,
  };
}

function profileFromCase(partial: Record<string, unknown>): Profile {
  const raw = {
    ...DEFAULT_PROFILE,
    known_gap_types: DEFAULT_PROFILE.known_gap_types.map((gap) => ({ ...gap })),
    forbidden_phrases: [...DEFAULT_PROFILE.forbidden_phrases],
    learning_asset_preferences: {
      formats: [...DEFAULT_PROFILE.learning_asset_preferences.formats],
    },
    ...partial,
  };
  const checked = validate(raw, 'load');
  if (checked.errors.length > 0) {
    throw new Error(`invalid case profile: ${checked.errors.join('; ')}`);
  }
  return checked.profile;
}

function loadGoldenCase(filePath: string): GoldenCase {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  const result = validateGoldenCase(raw);
  if (!result.valid) {
    throw new Error(`${filePath}: ${result.errors.join('; ')}`);
  }
  return raw as GoldenCase;
}

function tryLoadCandidateResponse(baselinesDir: string, caseId: string): string | null {
  const filePath = path.join(baselinesDir, `${caseId}.candidate.json`);
  try {
    const capture = validateCapture(
      JSON.parse(readFileSync(filePath, 'utf8')) as unknown,
      filePath,
    );
    if (capture.case_id !== caseId) {
      throw new Error(`${filePath}: case_id mismatch`);
    }
    return capture.response;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function emptyArtifact(skillVersion: string, mode: EvalArtifact['mode']): EvalArtifact {
  return {
    mode,
    skillVersion,
    datasetHash: '0'.repeat(64),
    judge: { status: 'skipped' },
    blockingCaseIds: [],
    failedBlockingCaseIds: [],
    cases: [],
    tokenOverhead: null,
  };
}

/** Gate 3 slice for smoke ids that already have both capture files. */
export function buildTokenOverheadForSmoke(options: {
  caseIds: readonly string[];
  baselinesDir: string;
}): TokenOverheadReport | null {
  const cases: CaseOverhead[] = [];
  for (const caseId of options.caseIds) {
    const baselinePath = path.join(options.baselinesDir, `${caseId}.baseline.json`);
    const candidatePath = path.join(options.baselinesDir, `${caseId}.candidate.json`);
    let baselineRaw: unknown;
    let candidateRaw: unknown;
    try {
      baselineRaw = JSON.parse(readFileSync(baselinePath, 'utf8')) as unknown;
      candidateRaw = JSON.parse(readFileSync(candidatePath, 'utf8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const baseline = validateCapture(baselineRaw, baselinePath);
    const candidate = validateCapture(candidateRaw, candidatePath);
    const baselineCodePoints = countCodePoints(baseline.response);
    const candidateCodePoints = countCodePoints(candidate.response);
    const percent = overheadPercent(baselineCodePoints, candidateCodePoints);
    cases.push({
      caseId,
      baselineCodePoints,
      candidateCodePoints,
      baselineEstimatedTokens: baselineCodePoints / 4,
      candidateEstimatedTokens: candidateCodePoints / 4,
      overheadPercent: percent,
      exceedsCeiling: percent > PER_CASE_CEILING_PERCENT,
    });
  }
  if (cases.length === 0) return null;

  const baselineCodePoints = cases.reduce((sum, item) => sum + item.baselineCodePoints, 0);
  const candidateCodePoints = cases.reduce((sum, item) => sum + item.candidateCodePoints, 0);
  const aggregatePercent = overheadPercent(baselineCodePoints, candidateCodePoints);
  return {
    approximateTokenMethod: 'Unicode code points / 4',
    ceilings: {
      aggregatePercent: AGGREGATE_CEILING_PERCENT,
      perCasePercent: PER_CASE_CEILING_PERCENT,
      // ponytail: still report-only until multi-trial captures + CI flip
      reportOnly: true,
    },
    cases,
    aggregate: {
      baselineCodePoints,
      candidateCodePoints,
      baselineEstimatedTokens: baselineCodePoints / 4,
      candidateEstimatedTokens: candidateCodePoints / 4,
      overheadPercent: aggregatePercent,
      exceedsCeiling: aggregatePercent > AGGREGATE_CEILING_PERCENT,
    },
  };
}

export function buildDryRunArtifact(input: {
  skillVersion: string;
  datasetHash: string;
  cases: Array<Omit<CaseSmokeResult, 'judge'>>;
  blockingCaseIds?: string[];
  tokenOverhead?: TokenOverheadReport | null;
}): EvalArtifact {
  const cases = input.cases.map((item) => ({ ...item, judge: null }));
  return {
    mode: 'dry-run',
    skillVersion: input.skillVersion,
    datasetHash: input.datasetHash,
    judge: { status: 'skipped' },
    blockingCaseIds: input.blockingCaseIds ?? cases.filter((c) => !c.quarantined).map((c) => c.caseId),
    failedBlockingCaseIds: [],
    cases,
    tokenOverhead: input.tokenOverhead ?? null,
  };
}

function verdictToTrial(verdict: JudgeVerdict): TrialVerdict {
  const dimensions: TrialVerdict['dimensions'] = {};
  for (const dimension of JUDGE_DIMENSIONS) {
    dimensions[dimension] = verdict.dimensions[dimension].pass;
  }
  return { dimensions };
}

async function judgeCase(options: {
  caseId: string;
  golden: GoldenCase;
  response: string;
  client: JudgeClient;
  pin: JudgePin;
  trialsPerCase: number;
}): Promise<CaseJudgeResult> {
  const trials: TrialVerdict[] = [];
  for (let i = 0; i < options.trialsPerCase; i += 1) {
    const verdict = await options.client.judge(
      {
        caseId: options.caseId,
        candidateText: options.response,
        rubricName: 'm1',
        referenceFacts: options.golden.reference_facts,
        mustPreserve: options.golden.must_preserve,
      },
      options.pin,
    );
    trials.push(verdictToTrial(verdict));
  }
  const aggregate = aggregateCaseTrials({
    caseId: options.caseId,
    trials,
    quarantined: false,
  });
  // ponytail: no trailing baseline file yet — require a clean trial set.
  const passed = aggregate.overallPasses === aggregate.trialCount;
  return {
    trialCount: aggregate.trialCount,
    overallPasses: aggregate.overallPasses,
    overallRate: aggregate.overallRate,
    dimensions: aggregate.dimensions,
    passed,
    reason: passed ? undefined : 'not all trials passed every rubric dimension',
  };
}

function resolveLiveJudge(options: EvalRunnerArgs): { client: JudgeClient; pin: JudgePin } {
  if (options.judgeClient) {
    return { client: options.judgeClient, pin: options.judgePin ?? options.judgeClient.pin };
  }
  const pin = options.judgePin ?? parseJudgePin(options.env ?? process.env);
  return { client: createHttpJudgeClient({ pin }), pin };
}

/** Sync dry-run only. Live mode must call `runEvalSmokeAsync`. */
export function runEvalSmoke(options: EvalRunnerArgs): EvalSmokeResult {
  if (!options.dryRun) {
    return {
      exitCode: 1,
      artifact: emptyArtifact(options.skillVersion, 'live'),
      error: 'live judge mode requires runEvalSmokeAsync',
    };
  }
  return runDrySmoke(options);
}

function runDrySmoke(options: EvalRunnerArgs): EvalSmokeResult {
  try {
    const manifest = loadSmokeManifest(options.smokeManifest);
    const quarantine = loadSmokeQuarantine(options.smokeQuarantine);
    const missingFromQuarantine = validateSmokeCaseIds(quarantine.caseIds, manifest.caseIds);
    if (missingFromQuarantine.length > 0) {
      throw new Error(`quarantine ids not in smoke manifest: ${missingFromQuarantine.join(', ')}`);
    }

    const datasetHash = hashDatasetManifest(readFileSync(options.smokeManifest, 'utf8'));
    const blockingCaseIds = resolveBlockingCaseIds(manifest.caseIds, quarantine.caseIds);
    const quarantined = new Set(quarantine.caseIds);
    const cases: Array<Omit<CaseSmokeResult, 'judge'>> = [];

    for (const caseId of manifest.caseIds) {
      const goldenPath = path.join(options.goldenDir, `${caseId}.json`);
      const golden = loadGoldenCase(goldenPath);
      if (golden.id !== caseId) {
        throw new Error(`${goldenPath}: id mismatch`);
      }

      const response = tryLoadCandidateResponse(options.baselinesDir, caseId);
      const isQuarantined = quarantined.has(caseId);

      if (response === null) {
        cases.push({
          caseId,
          candidateStatus: 'missing',
          layer1ErrorCount: 0,
          layer1WarnCount: 0,
          quarantined: isQuarantined,
        });
        continue;
      }

      const profile = profileFromCase(golden.profile);
      const violations = runChecks(response, profile, false);
      cases.push({
        caseId,
        candidateStatus: 'present',
        layer1ErrorCount: violations.filter((v) => v.severity === 'error').length,
        layer1WarnCount: violations.filter((v) => v.severity === 'warn').length,
        quarantined: isQuarantined,
        layer1Violations: violations,
      });
    }

    return {
      exitCode: 0,
      artifact: buildDryRunArtifact({
        skillVersion: options.skillVersion,
        datasetHash,
        blockingCaseIds,
        cases,
        tokenOverhead: buildTokenOverheadForSmoke({
          caseIds: cases.map((item) => item.caseId),
          baselinesDir: options.baselinesDir,
        }),
      }),
    };
  } catch (error) {
    return {
      exitCode: 1,
      artifact: emptyArtifact(options.skillVersion, 'dry-run'),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runEvalSmokeAsync(options: EvalRunnerArgs): Promise<EvalSmokeResult> {
  if (options.dryRun) {
    return runDrySmoke(options);
  }

  try {
    const manifest = loadSmokeManifest(options.smokeManifest);
    const quarantine = loadSmokeQuarantine(options.smokeQuarantine);
    const missingFromQuarantine = validateSmokeCaseIds(quarantine.caseIds, manifest.caseIds);
    if (missingFromQuarantine.length > 0) {
      throw new Error(`quarantine ids not in smoke manifest: ${missingFromQuarantine.join(', ')}`);
    }

    const { client, pin } = resolveLiveJudge(options);
    const datasetHash = hashDatasetManifest(readFileSync(options.smokeManifest, 'utf8'));
    const blockingCaseIds = resolveBlockingCaseIds(manifest.caseIds, quarantine.caseIds);
    const quarantined = new Set(quarantine.caseIds);
    const cases: CaseSmokeResult[] = [];

    for (const caseId of manifest.caseIds) {
      const goldenPath = path.join(options.goldenDir, `${caseId}.json`);
      const golden = loadGoldenCase(goldenPath);
      if (golden.id !== caseId) {
        throw new Error(`${goldenPath}: id mismatch`);
      }

      const response = tryLoadCandidateResponse(options.baselinesDir, caseId);
      const isQuarantined = quarantined.has(caseId);

      if (response === null) {
        cases.push({
          caseId,
          candidateStatus: 'missing',
          layer1ErrorCount: 0,
          layer1WarnCount: 0,
          quarantined: isQuarantined,
          judge: failedJudge('candidate missing'),
        });
        continue;
      }

      const profile = profileFromCase(golden.profile);
      const violations = runChecks(response, profile, false);
      const layer1ErrorCount = violations.filter((v) => v.severity === 'error').length;
      const layer1WarnCount = violations.filter((v) => v.severity === 'warn').length;

      if (layer1ErrorCount > 0) {
        cases.push({
          caseId,
          candidateStatus: 'present',
          layer1ErrorCount,
          layer1WarnCount,
          quarantined: isQuarantined,
          layer1Violations: violations,
          judge: failedJudge('layer1 errors'),
        });
        continue;
      }

      const judge = await judgeCase({
        caseId,
        golden,
        response,
        client,
        pin,
        trialsPerCase: options.trialsPerCase,
      });
      cases.push({
        caseId,
        candidateStatus: 'present',
        layer1ErrorCount,
        layer1WarnCount,
        quarantined: isQuarantined,
        layer1Violations: violations,
        judge,
      });
    }

    const failedBlockingCaseIds = cases
      .filter((item) => !item.quarantined && item.judge !== null && !item.judge.passed)
      .map((item) => item.caseId);

    return {
      exitCode: failedBlockingCaseIds.length === 0 ? 0 : 1,
      artifact: {
        mode: 'live',
        skillVersion: options.skillVersion,
        datasetHash,
        judge: {
          status: 'ran',
          modelId: pin.modelId,
          modelVersion: pin.modelVersion,
          temperature: JUDGE_TEMPERATURE,
          trialsPerCase: options.trialsPerCase,
        },
        blockingCaseIds,
        failedBlockingCaseIds,
        cases,
        tokenOverhead: buildTokenOverheadForSmoke({
          caseIds: cases.map((item) => item.caseId),
          baselinesDir: options.baselinesDir,
        }),
      },
    };
  } catch (error) {
    return {
      exitCode: 1,
      artifact: emptyArtifact(options.skillVersion, 'live'),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runAsync(argv: string[]): Promise<number> {
  let args: EvalRunnerArgs;
  try {
    args = parseEvalRunnerArgs(argv);
  } catch (error) {
    process.stderr.write(`usage error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  const result = await runEvalSmokeAsync(args);
  if (result.error) process.stderr.write(`eval-smoke error: ${result.error}\n`);
  process.stdout.write(
    args.json ? `${JSON.stringify(result.artifact)}\n` : formatHuman(result.artifact, result.error),
  );
  return result.exitCode;
}

/** Sync CLI entry for dry-run; live throws usage toward runAsync. */
export function run(argv: string[]): number {
  let args: EvalRunnerArgs;
  try {
    args = parseEvalRunnerArgs(argv);
  } catch (error) {
    process.stderr.write(`usage error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  if (!args.dryRun) {
    process.stderr.write('eval-smoke error: --live requires the async CLI entry (node src/eval-runner.ts --live)\n');
    return 2;
  }
  const result = runDrySmoke(args);
  if (result.error) process.stderr.write(`eval-smoke error: ${result.error}\n`);
  process.stdout.write(
    args.json ? `${JSON.stringify(result.artifact)}\n` : formatHuman(result.artifact, result.error),
  );
  return result.exitCode;
}

function formatHuman(artifact: EvalArtifact, error?: string): string {
  if (error) return `${error}\n`;
  const judgeLine =
    artifact.judge.status === 'skipped'
      ? 'judge: skipped'
      : `judge: ${artifact.judge.modelId}@${artifact.judge.modelVersion} temp=${artifact.judge.temperature} trials=${artifact.judge.trialsPerCase}`;
  const tokenLine =
    artifact.tokenOverhead === null
      ? 'token_overhead: n/a'
      : `token_overhead: aggregate ${artifact.tokenOverhead.aggregate.overheadPercent.toFixed(2)}% over ${artifact.tokenOverhead.cases.length} paired case(s)${artifact.tokenOverhead.aggregate.exceedsCeiling ? ' EXCEEDS' : ''} (report-only)`;
  const lines = [
    `mode: ${artifact.mode}`,
    `skill: ${artifact.skillVersion}`,
    `dataset_hash: ${artifact.datasetHash}`,
    judgeLine,
    tokenLine,
    `cases: ${artifact.cases.length} (blocking ${artifact.blockingCaseIds.length}, failed ${artifact.failedBlockingCaseIds.length})`,
    ...artifact.cases.map((item) => {
      const judgeBit =
        item.judge === null
          ? 'judge=n/a'
          : `judge=${item.judge.passed ? 'pass' : 'fail'}${item.judge.reason ? ` (${item.judge.reason})` : ''}`;
      return `- ${item.caseId}: candidate=${item.candidateStatus} layer1_errors=${item.layer1ErrorCount} ${judgeBit}${item.quarantined ? ' quarantined' : ''}`;
    }),
  ];
  return `${lines.join('\n')}\n`;
}

function isDirectExecution(argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

if (isDirectExecution(process.argv[1])) {
  process.exitCode = await runAsync(process.argv.slice(2));
}
