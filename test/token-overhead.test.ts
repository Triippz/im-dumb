import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  AGGREGATE_CEILING_PERCENT,
  PER_CASE_CEILING_PERCENT,
  buildTokenOverheadReport,
  buildTokenOverheadReportFromPairs,
  countCodePoints,
  estimateTokens,
  formatHumanReport,
  captureCodePoints,
  hashDatasetManifest,
  median,
  pairCaptures,
  parseArgs,
  validateCapture,
  type Capture,
  type CliArgs,
  type ExpectedCaptureSet,
  type ParseArgsResult,
} from '../src/token-overhead.ts';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const cli = path.join(repoRoot, 'src', 'token-overhead.ts');
const DATASET_HASH = 'a'.repeat(64);
const EXPECTED: ExpectedCaptureSet = { caseIds: ['case-a'], datasetHash: DATASET_HASH, skillVersion: '0.1.0' };

function expectParsed(result: ParseArgsResult): CliArgs {
  assert.equal(result.ok, true);
  return result.args;
}

function capture(kind: 'baseline' | 'candidate', response: string, overrides: Partial<Capture> = {}): Capture {
  return {
    case_id: 'case-a',
    kind,
    model_id: 'model',
    model_version: '2026-01-01',
    date: '2026-02-01',
    settings: { temperature: 0, nested: { top_p: 1 } },
    skill_version: '0.1.0',
    trial_count: 1,
    dataset_hash: DATASET_HASH,
    response,
    ...overrides,
  };
}

test('math retains fractional chars/4 estimates and computes per-case overhead', () => {
  const report = buildTokenOverheadReport([capture('baseline', 'abc'), capture('candidate', 'abcdef')], EXPECTED);
  assert.equal(report.cases[0]!.baselineEstimatedTokens, 0.75);
  assert.equal(report.cases[0]!.candidateEstimatedTokens, 1.5);
  assert.equal(report.cases[0]!.overheadPercent, 100);
});

test('Unicode counting uses code points rather than UTF-16 code units', () => {
  assert.equal('😀'.length, 2);
  assert.equal(countCodePoints('A😀é'), 3);
  assert.equal(estimateTokens('A😀é'), 0.75);
});

test('aggregate is weighted by baseline size, not the mean of case percentages', () => {
  const expected = { ...EXPECTED, caseIds: ['short', 'long'] };
  const captures = [
    capture('baseline', 'x', { case_id: 'short' }),
    capture('candidate', 'xx', { case_id: 'short' }),
    capture('baseline', '123456789', { case_id: 'long' }),
    capture('candidate', '123456789', { case_id: 'long' }),
  ];
  const report = buildTokenOverheadReport(captures, expected);
  const mean = report.cases.reduce((sum, item) => sum + item.overheadPercent, 0) / report.cases.length;
  assert.equal(mean, 50);
  assert.ok(Math.abs(report.aggregate.overheadPercent - 10) < 1e-12);
});

test('settings comparison ignores object key order but preserves values', () => {
  const baseline = capture('baseline', 'base', { settings: { temperature: 0, top_p: 1 } });
  const candidate = capture('candidate', 'candidate', { settings: { top_p: 1, temperature: 0 } });
  assert.equal(pairCaptures([baseline, candidate], EXPECTED).length, 1);
});

test('invalid capture fields and pairs are hard errors', () => {
  assert.throws(() => validateCapture({}), /kind/);
  assert.throws(() => validateCapture({ ...capture('baseline', 'x'), response: 1 }), /response/);
  assert.throws(() => validateCapture({ ...capture('baseline', 'x'), trial_count: 2 }), /trial_count/);
  assert.throws(() => pairCaptures([capture('baseline', 'x')], EXPECTED), /missing candidate/);
  assert.throws(
    () => pairCaptures([capture('baseline', 'x'), capture('baseline', 'x'), capture('candidate', 'y')], EXPECTED),
    /duplicate baseline/,
  );
  assert.throws(
    () => pairCaptures([capture('baseline', 'x', { case_id: 'other' }), capture('candidate', 'y')], EXPECTED),
    /unexpected case id/,
  );
});

test('mismatched dataset, skill, model, model version, or settings are hard errors', () => {
  const baseline = capture('baseline', 'x');
  assert.throws(
    () => pairCaptures([baseline, capture('candidate', 'y', { dataset_hash: 'b'.repeat(64) })], EXPECTED),
    /dataset_hash/,
  );
  assert.throws(
    () => pairCaptures([baseline, capture('candidate', 'y', { skill_version: '0.2.0' })], EXPECTED),
    /skill_version/,
  );
  assert.throws(() => pairCaptures([baseline, capture('candidate', 'y', { model_id: 'other' })], EXPECTED), /model_id/);
  assert.throws(
    () => pairCaptures([baseline, capture('candidate', 'y', { model_version: 'other' })], EXPECTED),
    /model_version/,
  );
  assert.throws(
    () => pairCaptures([baseline, capture('candidate', 'y', { settings: { temperature: 1 } })], EXPECTED),
    /settings/,
  );
});

test('from-pairs report rejects mismatched pair metadata', () => {
  assert.throws(
    () => buildTokenOverheadReportFromPairs([{
      caseId: 'case-a',
      baseline: capture('candidate', 'base', { case_id: 'wrong' }),
      candidate: capture('baseline', 'next'),
    }]),
    /case_id|kinds/,
  );
});

test('median collapses trials, so one long sample cannot swing a case', () => {
  assert.equal(median([3]), 3);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 10]), 2.5);

  const multi = capture('candidate', 'ignored', { trial_count: 3, trial_responses: ['aa', 'aaaa', 'a'.repeat(400)] });
  assert.equal(captureCodePoints(multi), 4);
  assert.equal(captureCodePoints(capture('baseline', 'abcd')), 4);
});

test('trial_responses must line up with trial_count, and many trials require them', () => {
  assert.throws(
    () => validateCapture({ ...capture('baseline', 'x'), trial_count: 3, trial_responses: ['a', 'b'] }),
    /trial_responses" must hold exactly/u,
  );
  assert.throws(
    () => validateCapture({ ...capture('baseline', 'x'), trial_count: 4 }),
    /above 1 requires "trial_responses"/u,
  );
  assert.throws(
    () => validateCapture({ ...capture('baseline', 'x'), trial_count: 2, trial_responses: ['a', 7] }),
    /array of strings/u,
  );
  assert.throws(() => validateCapture({ ...capture('baseline', 'x'), trial_count: 0 }), /at least 1/u);
});

test('skill_sha256 is optional, format-checked, and pinned across a pair', () => {
  assert.equal(validateCapture(capture('baseline', 'x')).skill_sha256, undefined);
  assert.throws(() => validateCapture({ ...capture('baseline', 'x'), skill_sha256: 'nope' }), /64-character lowercase hex/u);

  assert.throws(
    () => buildTokenOverheadReportFromPairs([{
      caseId: 'case-a',
      baseline: capture('baseline', 'base', { skill_sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
      candidate: capture('candidate', 'next', { skill_sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' }),
    }]),
    /skill_sha256 must match/u,
  );
});

test('a capture whose skill digest differs from the skill on disk is rejected', () => {
  const expected: ExpectedCaptureSet = { ...EXPECTED, skillSha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' };
  assert.throws(
    () => pairCaptures([
      capture('baseline', 'base', { skill_sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' }),
      capture('candidate', 'next', { skill_sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' }),
    ], expected),
    /skill_sha256 does not match the skill document on disk/u,
  );

  const pairs = pairCaptures([
    capture('baseline', 'base', { skill_sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
    capture('candidate', 'next', { skill_sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
  ], expected);
  assert.equal(pairs.length, 1);
});

test('captures written before skill digests stay valid', () => {
  const pairs = pairCaptures([capture('baseline', 'base'), capture('candidate', 'next')], { ...EXPECTED, skillSha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
  assert.equal(pairs.length, 1);
});

test('zero-character baseline is a hard error', () => {
  assert.throws(() => buildTokenOverheadReport([capture('baseline', ''), capture('candidate', 'x')], EXPECTED), /must not be empty/);
});

test('ceiling breaches are marked report-only in the result', () => {
  const report = buildTokenOverheadReport([capture('baseline', '1234'), capture('candidate', '12345678')], EXPECTED);
  assert.equal(AGGREGATE_CEILING_PERCENT, 30);
  assert.equal(PER_CASE_CEILING_PERCENT, 60);
  assert.equal(report.cases[0]!.exceedsCeiling, true);
  assert.equal(report.aggregate.exceedsCeiling, true);
  assert.equal(report.ceilings.reportOnly, true);
});

test('human report labels derive from the report ceilings', () => {
  const report = buildTokenOverheadReport([capture('baseline', '1234'), capture('candidate', '12345678')], EXPECTED);
  report.ceilings.perCasePercent = 61;
  report.ceilings.aggregatePercent = 31;
  const output = formatHumanReport(report);
  assert.match(output, /case-a: .* EXCEEDS \+61%/u);
  assert.match(output, /Aggregate: .* EXCEEDS \+31%/u);
  assert.doesNotMatch(output, /EXCEEDS \+(?:60|30)%/u);
});

test('parseArgs exports typed results and rejects missing or option-shaped values', () => {
  assert.equal(expectParsed(parseArgs(['--captures', 'captures', '--json'])).captures, 'captures');
  for (const argv of [
    ['--captures'],
    ['--manifest', '--json'],
    ['--skill-version', '--captures', 'captures'],
  ]) {
    const result: ParseArgsResult = parseArgs(argv);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /requires a value/u);
  }
});

test('all compiled CLI modules are safe to import from stdin and still execute through symlinks', () => {
  const modules = ['dist/profile.js', 'dist/check-cli.js', 'dist/token-overhead.js'];
  const urls = modules.map((file) => pathToFileURL(path.join(repoRoot, file)).href);
  const imported = spawnSync(process.execPath, ['--input-type=module', '-'], {
    cwd: repoRoot,
    input: `for (const url of ${JSON.stringify(urls)}) await import(url);`,
    encoding: 'utf8',
  });
  assert.equal(imported.status, 0, imported.stderr);

  const links = mkdtempSync(path.join(tmpdir(), 'im-dumb-cli-links-'));
  const executions = [
    { file: 'dist/profile.js', args: [] },
    { file: 'dist/check-cli.js', args: ['--unknown'] },
    { file: 'dist/token-overhead.js', args: ['--unknown'] },
  ];
  for (const [index, execution] of executions.entries()) {
    const link = path.join(links, `cli-${index}.js`);
    symlinkSync(path.join(repoRoot, execution.file), link);
    const result = spawnSync(process.execPath, [link, ...execution.args], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(result.status, 2, `${execution.file}: ${result.stderr}`);
  }
});

function writeCliSet(options: { malformed?: boolean; omitCandidate?: boolean } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'im-dumb-overhead-'));
  const captures = path.join(root, 'captures');
  mkdirSync(captures);
  const manifestContents = `${JSON.stringify({ cases: [{ id: 'case-a' }] }, null, 2)}\n`;
  const manifest = path.join(root, 'manifest.json');
  writeFileSync(manifest, manifestContents, 'utf8');
  const datasetHash = hashDatasetManifest(manifestContents);
  const base = capture('baseline', '1234', { dataset_hash: datasetHash });
  const candidate = capture('candidate', '12345678', { dataset_hash: datasetHash });
  writeFileSync(path.join(captures, 'case-a.baseline.json'), options.malformed ? '{bad' : JSON.stringify(base), 'utf8');
  if (!options.omitCandidate) writeFileSync(path.join(captures, 'case-a.candidate.json'), JSON.stringify(candidate), 'utf8');
  return { captures, manifest };
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: repoRoot, encoding: 'utf8' });
}

test('CLI emits JSON and exits 0 even when report-only ceilings are exceeded', () => {
  const files = writeCliSet();
  const result = runCli([
    '--captures',
    files.captures,
    '--manifest',
    files.manifest,
    '--skill-version',
    '0.1.0',
    '--json',
  ]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.aggregate.exceedsCeiling, true);
  assert.equal(report.ceilings.reportOnly, true);
});

test('CLI treats malformed JSON and missing pairs as capture errors', () => {
  const malformed = writeCliSet({ malformed: true });
  const malformedResult = runCli([
    '--captures',
    malformed.captures,
    '--manifest',
    malformed.manifest,
    '--skill-version',
    '0.1.0',
  ]);
  assert.equal(malformedResult.status, 1);
  assert.match(malformedResult.stderr, /malformed JSON/);

  const missing = writeCliSet({ omitCandidate: true });
  const missingResult = runCli([
    '--captures',
    missing.captures,
    '--manifest',
    missing.manifest,
    '--skill-version',
    '0.1.0',
  ]);
  assert.equal(missingResult.status, 1);
  assert.match(missingResult.stderr, /missing candidate/);
});

test('CLI returns usage exit 2 for an unknown option', () => {
  const result = runCli(['--unknown']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /usage error/);
});
