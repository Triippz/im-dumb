import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runChecks } from './check-cli.ts';
import type { Violation } from './checkers.ts';
import { validateGoldenCase, type GoldenCase } from './golden-schema.ts';
import { DEFAULT_PROFILE, validate, type Profile } from './profile.ts';
import {
  loadSmokeManifest,
  loadSmokeQuarantine,
  resolveBlockingCaseIds,
  validateSmokeCaseIds,
} from './smoke-manifest.ts';
import { hashDatasetManifest, validateCapture } from './token-overhead.ts';

export interface EvalRunnerArgs {
  dryRun: boolean;
  json: boolean;
  smokeManifest: string;
  smokeQuarantine: string;
  baselinesDir: string;
  goldenDir: string;
  repoRoot: string;
  skillVersion: string;
}

export type CandidateStatus = 'present' | 'missing';

export interface CaseSmokeResult {
  caseId: string;
  candidateStatus: CandidateStatus;
  layer1ErrorCount: number;
  layer1WarnCount: number;
  quarantined: boolean;
  layer1Violations?: Violation[];
  judge: null;
}

export interface DryRunArtifact {
  mode: 'dry-run';
  skillVersion: string;
  datasetHash: string;
  judge: { status: 'skipped' };
  blockingCaseIds: string[];
  cases: CaseSmokeResult[];
}

export interface EvalSmokeResult {
  exitCode: number;
  artifact: DryRunArtifact;
  error?: string;
}

const DEFAULT_SKILL_VERSION = '0.2.0';

function defaultRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function parseEvalRunnerArgs(argv: string[], repoRoot = defaultRepoRoot()): EvalRunnerArgs {
  let dryRun = true;
  let json = false;
  let smokeManifest = path.join(repoRoot, 'eval/smoke-manifest.json');
  let smokeQuarantine = path.join(repoRoot, 'eval/smoke-quarantine.json');
  let baselinesDir = path.join(repoRoot, 'eval/baselines');
  let goldenDir = path.join(repoRoot, 'eval/golden/cases');
  let skillVersion = DEFAULT_SKILL_VERSION;

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

export function buildDryRunArtifact(input: {
  skillVersion: string;
  datasetHash: string;
  cases: Array<Omit<CaseSmokeResult, 'judge'> & { judge?: null }>;
  blockingCaseIds?: string[];
}): DryRunArtifact {
  return {
    mode: 'dry-run',
    skillVersion: input.skillVersion,
    datasetHash: input.datasetHash,
    judge: { status: 'skipped' },
    blockingCaseIds: input.blockingCaseIds ?? input.cases.filter((c) => !c.quarantined).map((c) => c.caseId),
    cases: input.cases.map((item) => ({ ...item, judge: null })),
  };
}

export function runEvalSmoke(options: EvalRunnerArgs): EvalSmokeResult {
  try {
    if (!options.dryRun) {
      return {
        exitCode: 1,
        artifact: buildDryRunArtifact({
          skillVersion: options.skillVersion,
          datasetHash: '0'.repeat(64),
          cases: [],
        }),
        error: 'live judge mode is not wired yet; use --dry-run',
      };
    }

    const manifest = loadSmokeManifest(options.smokeManifest);
    const quarantine = loadSmokeQuarantine(options.smokeQuarantine);
    const knownIds = manifest.caseIds; // validated against disk below via file loads
    const missingFromQuarantine = validateSmokeCaseIds(quarantine.caseIds, knownIds);
    if (missingFromQuarantine.length > 0) {
      throw new Error(
        `quarantine ids not in smoke manifest: ${missingFromQuarantine.join(', ')}`,
      );
    }

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
      if (response === null) {
        cases.push({
          caseId,
          candidateStatus: 'missing',
          layer1ErrorCount: 0,
          layer1WarnCount: 0,
          quarantined: quarantined.has(caseId),
          judge: null,
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
        quarantined: quarantined.has(caseId),
        layer1Violations: violations,
        judge: null,
      });
    }

    const artifact = buildDryRunArtifact({
      skillVersion: options.skillVersion,
      datasetHash,
      blockingCaseIds,
      cases,
    });
    return { exitCode: 0, artifact };
  } catch (error) {
    return {
      exitCode: 1,
      artifact: buildDryRunArtifact({
        skillVersion: options.skillVersion,
        datasetHash: '0'.repeat(64),
        cases: [],
      }),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function run(argv: string[]): number {
  let args: EvalRunnerArgs;
  try {
    args = parseEvalRunnerArgs(argv);
  } catch (error) {
    process.stderr.write(`usage error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  const result = runEvalSmoke(args);
  if (result.error) {
    process.stderr.write(`eval-smoke error: ${result.error}\n`);
  }
  process.stdout.write(
    args.json ? `${JSON.stringify(result.artifact)}\n` : formatHuman(result.artifact, result.error),
  );
  return result.exitCode;
}

function formatHuman(artifact: DryRunArtifact, error?: string): string {
  if (error) return `${error}\n`;
  const lines = [
    `mode: ${artifact.mode}`,
    `skill: ${artifact.skillVersion}`,
    `dataset_hash: ${artifact.datasetHash}`,
    `judge: ${artifact.judge.status}`,
    `cases: ${artifact.cases.length} (blocking ${artifact.blockingCaseIds.length})`,
    ...artifact.cases.map(
      (item) =>
        `- ${item.caseId}: candidate=${item.candidateStatus} layer1_errors=${item.layer1ErrorCount} layer1_warns=${item.layer1WarnCount}${item.quarantined ? ' quarantined' : ''}`,
    ),
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

if (isDirectExecution(process.argv[1])) process.exitCode = run(process.argv.slice(2));
