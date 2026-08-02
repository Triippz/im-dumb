import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

export const AGGREGATE_CEILING_PERCENT = 30;
export const PER_CASE_CEILING_PERCENT = 60;
export const REQUIRED_TRIAL_COUNT = 1;

export type CaptureKind = 'baseline' | 'candidate';

export interface Capture {
  case_id: string;
  kind: CaptureKind;
  model_id: string;
  model_version: string;
  date: string;
  settings: Record<string, unknown>;
  skill_version: string;
  trial_count: number;
  dataset_hash: string;
  response: string;
}

export interface ExpectedCaptureSet {
  caseIds: string[];
  datasetHash: string;
  skillVersion: string;
}

export interface CapturePair {
  caseId: string;
  baseline: Capture;
  candidate: Capture;
}

export interface CaseOverhead {
  caseId: string;
  baselineCodePoints: number;
  candidateCodePoints: number;
  baselineEstimatedTokens: number;
  candidateEstimatedTokens: number;
  overheadPercent: number;
  exceedsCeiling: boolean;
}

export interface TokenOverheadReport {
  approximateTokenMethod: 'Unicode code points / 4';
  ceilings: {
    aggregatePercent: number;
    perCasePercent: number;
    reportOnly: true;
  };
  cases: CaseOverhead[];
  aggregate: {
    baselineCodePoints: number;
    candidateCodePoints: number;
    baselineEstimatedTokens: number;
    candidateEstimatedTokens: number;
    overheadPercent: number;
    exceedsCeiling: boolean;
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(raw: Record<string, unknown>, field: string, source: string): string {
  const value = raw[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${source}: "${field}" must be a non-empty string`);
  }
  return value;
}

export function validateCapture(raw: unknown, source = 'capture'): Capture {
  if (!isPlainObject(raw)) throw new Error(`${source}: capture must be an object`);

  const kind = raw.kind;
  if (kind !== 'baseline' && kind !== 'candidate') {
    throw new Error(`${source}: "kind" must be baseline or candidate`);
  }
  if (!isPlainObject(raw.settings)) {
    throw new Error(`${source}: "settings" must be an object`);
  }
  if (!Number.isInteger(raw.trial_count) || raw.trial_count !== REQUIRED_TRIAL_COUNT) {
    throw new Error(`${source}: "trial_count" must be ${REQUIRED_TRIAL_COUNT} in M1`);
  }
  if (typeof raw.response !== 'string') {
    throw new Error(`${source}: "response" must be a string`);
  }

  return {
    case_id: requiredString(raw, 'case_id', source),
    kind,
    model_id: requiredString(raw, 'model_id', source),
    model_version: requiredString(raw, 'model_version', source),
    date: requiredString(raw, 'date', source),
    settings: raw.settings,
    skill_version: requiredString(raw, 'skill_version', source),
    trial_count: raw.trial_count as number,
    dataset_hash: requiredString(raw, 'dataset_hash', source),
    response: raw.response,
  };
}

export function pairCaptures(rawCaptures: unknown[], expected: ExpectedCaptureSet): CapturePair[] {
  if (expected.caseIds.length === 0) throw new Error('expected case set is empty');
  if (new Set(expected.caseIds).size !== expected.caseIds.length) throw new Error('expected case ids contain duplicates');

  const expectedIds = new Set(expected.caseIds);
  const captures = rawCaptures.map((raw, index) => validateCapture(raw, `capture[${index}]`));
  const byKey = new Map<string, Capture>();

  for (const capture of captures) {
    if (!expectedIds.has(capture.case_id)) throw new Error(`unexpected case id "${capture.case_id}"`);
    if (capture.dataset_hash !== expected.datasetHash) {
      throw new Error(`case "${capture.case_id}" ${capture.kind}: dataset_hash does not match the golden manifest`);
    }
    if (capture.skill_version !== expected.skillVersion) {
      throw new Error(`case "${capture.case_id}" ${capture.kind}: skill_version must be ${expected.skillVersion}`);
    }

    const key = `${capture.case_id}\0${capture.kind}`;
    if (byKey.has(key)) throw new Error(`duplicate ${capture.kind} capture for case "${capture.case_id}"`);
    byKey.set(key, capture);
  }

  return [...expectedIds]
    .sort((a, b) => a.localeCompare(b))
    .map((caseId) => {
      const baseline = byKey.get(`${caseId}\0baseline`);
      const candidate = byKey.get(`${caseId}\0candidate`);
      if (!baseline || !candidate) {
        const missing = baseline ? 'candidate' : 'baseline';
        throw new Error(`missing ${missing} capture for case "${caseId}"`);
      }
      return validateCapturePair({ caseId, baseline, candidate });
    });
}

export function validateCapturePair(pair: CapturePair): CapturePair {
  const { caseId, baseline, candidate } = pair;
  if (baseline.case_id !== caseId || candidate.case_id !== caseId) {
    throw new Error(`case "${caseId}": capture case_id must match pair id`);
  }
  if (baseline.kind !== 'baseline' || candidate.kind !== 'candidate') {
    throw new Error(`case "${caseId}": capture kinds must be baseline and candidate`);
  }
  if (countCodePoints(baseline.response) === 0) {
    throw new Error(`case "${caseId}": baseline response must not be empty`);
  }
  for (const field of ['model_id', 'model_version'] as const) {
    if (baseline[field] !== candidate[field]) {
      throw new Error(`case "${caseId}": baseline and candidate ${field} must match`);
    }
  }
  if (!isDeepStrictEqual(baseline.settings, candidate.settings)) {
    throw new Error(`case "${caseId}": baseline and candidate settings must match`);
  }
  return pair;
}

export function countCodePoints(text: string): number {
  return [...text].length;
}

export function estimateTokens(text: string): number {
  return countCodePoints(text) / 4;
}

export function overheadPercent(baselineCodePoints: number, candidateCodePoints: number): number {
  if (baselineCodePoints === 0) throw new Error('baseline response must not be empty');
  return (candidateCodePoints / baselineCodePoints - 1) * 100;
}

export function buildTokenOverheadReport(rawCaptures: unknown[], expected: ExpectedCaptureSet): TokenOverheadReport {
  return buildTokenOverheadReportFromPairs(pairCaptures(rawCaptures, expected));
}

export function buildTokenOverheadReportFromPairs(pairs: readonly CapturePair[]): TokenOverheadReport {
  if (pairs.length === 0) throw new Error('capture pair set is empty');
  const cases = pairs.map(({ caseId, baseline, candidate }): CaseOverhead => {
    validateCapturePair({ caseId, baseline, candidate });
    const baselineCodePoints = countCodePoints(baseline.response);
    const candidateCodePoints = countCodePoints(candidate.response);
    const percent = overheadPercent(baselineCodePoints, candidateCodePoints);
    return {
      caseId,
      baselineCodePoints,
      candidateCodePoints,
      baselineEstimatedTokens: baselineCodePoints / 4,
      candidateEstimatedTokens: candidateCodePoints / 4,
      overheadPercent: percent,
      exceedsCeiling: percent > PER_CASE_CEILING_PERCENT,
    };
  });

  const baselineCodePoints = cases.reduce((sum, item) => sum + item.baselineCodePoints, 0);
  const candidateCodePoints = cases.reduce((sum, item) => sum + item.candidateCodePoints, 0);
  const aggregatePercent = overheadPercent(baselineCodePoints, candidateCodePoints);

  return {
    approximateTokenMethod: 'Unicode code points / 4',
    ceilings: {
      aggregatePercent: AGGREGATE_CEILING_PERCENT,
      perCasePercent: PER_CASE_CEILING_PERCENT,
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

export function hashDatasetManifest(contents: string): string {
  return createHash('sha256').update(contents, 'utf8').digest('hex');
}

interface ManifestEntry {
  id?: unknown;
}

export interface CliArgs {
  captures: string;
  manifest: string;
  skillVersion?: string;
  json: boolean;
}

export type ParseArgsResult = { ok: true; args: CliArgs } | { ok: false; message: string };

export function parseArgs(argv: string[]): ParseArgsResult {
  const args: CliArgs = { captures: 'eval/baselines', manifest: 'eval/golden/manifest.json', json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === '--json') {
      args.json = true;
      continue;
    }
    if (token === '--captures' || token === '--manifest' || token === '--skill-version') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) return { ok: false, message: `${token} requires a value` };
      if (token === '--captures') args.captures = value;
      else if (token === '--manifest') args.manifest = value;
      else args.skillVersion = value;
      index += 1;
      continue;
    }
    return { ok: false, message: `unrecognized argument: ${token}` };
  }
  return { ok: true, args };
}

function readJson(file: string): unknown {
  let contents: string;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`cannot read ${file}`);
  }
  try {
    return JSON.parse(contents) as unknown;
  } catch {
    throw new Error(`malformed JSON in ${file}`);
  }
}

function loadExpected(manifestPath: string, skillVersionArg: string | undefined): ExpectedCaptureSet {
  let manifestContents: string;
  try {
    manifestContents = readFileSync(manifestPath, 'utf8');
  } catch {
    throw new Error(`cannot read ${manifestPath}`);
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestContents) as unknown;
  } catch {
    throw new Error(`malformed JSON in ${manifestPath}`);
  }
  if (!isPlainObject(manifest) || !Array.isArray(manifest.cases)) {
    throw new Error(`${manifestPath}: "cases" must be an array`);
  }
  const caseIds = manifest.cases.map((entry: ManifestEntry, index: number) => {
    if (!isPlainObject(entry) || typeof entry.id !== 'string' || entry.id.trim() === '') {
      throw new Error(`${manifestPath}: cases[${index}].id must be a non-empty string`);
    }
    return entry.id;
  });

  let skillVersion = skillVersionArg;
  if (skillVersion === undefined) {
    const packageJson = readJson('package.json');
    if (!isPlainObject(packageJson) || typeof packageJson.version !== 'string' || packageJson.version.trim() === '') {
      throw new Error('package.json: "version" must be a non-empty string');
    }
    skillVersion = packageJson.version;
  }

  return { caseIds, datasetHash: hashDatasetManifest(manifestContents), skillVersion };
}

function loadCaptures(directory: string): unknown[] {
  let files: string[];
  try {
    files = readdirSync(directory)
      .filter((file) => file.endsWith('.json'))
      .sort();
  } catch {
    throw new Error(`cannot read capture directory ${directory}`);
  }
  return files.map((file) => readJson(path.join(directory, file)));
}

export function formatHumanReport(report: TokenOverheadReport): string {
  const lines = [
    'Approximate tokens: Unicode code points / 4 (fractional estimates retained)',
    ...report.cases.map(
      (item) =>
        `${item.caseId}: ${item.overheadPercent.toFixed(2)}% (${item.baselineEstimatedTokens} -> ${item.candidateEstimatedTokens})${item.exceedsCeiling ? ` EXCEEDS +${report.ceilings.perCasePercent}%` : ''}`,
    ),
    `Aggregate: ${report.aggregate.overheadPercent.toFixed(2)}% (${report.aggregate.baselineEstimatedTokens} -> ${report.aggregate.candidateEstimatedTokens})${report.aggregate.exceedsCeiling ? ` EXCEEDS +${report.ceilings.aggregatePercent}%` : ''}`,
    'Ceilings are report-only in M1.',
  ];
  return `${lines.join('\n')}\n`;
}

export function run(argv: string[]): number {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`usage error: ${parsed.message}\n`);
    return 2;
  }

  try {
    const expected = loadExpected(parsed.args.manifest, parsed.args.skillVersion);
    const report = buildTokenOverheadReport(loadCaptures(parsed.args.captures), expected);
    process.stdout.write(parsed.args.json ? `${JSON.stringify(report)}\n` : formatHumanReport(report));
    return 0;
  } catch (error) {
    process.stderr.write(`capture error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
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
