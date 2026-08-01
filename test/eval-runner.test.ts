import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildDryRunArtifact,
  parseEvalRunnerArgs,
  runEvalSmoke,
} from '../src/eval-runner.ts';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');

test('parseEvalRunnerArgs: defaults to dry-run and repo eval paths', () => {
  const args = parseEvalRunnerArgs([]);
  assert.equal(args.dryRun, true);
  assert.equal(args.json, false);
  assert.match(args.smokeManifest, /smoke-manifest\.json$/);
});

test('parseEvalRunnerArgs: --live requires explicit opt-in (still needs pin at run time)', () => {
  const args = parseEvalRunnerArgs(['--live', '--json']);
  assert.equal(args.dryRun, false);
  assert.equal(args.json, true);
});

test('buildDryRunArtifact: judge_skipped and never invents dimension passes', () => {
  const artifact = buildDryRunArtifact({
    skillVersion: '0.2.0',
    datasetHash: 'a'.repeat(64),
    cases: [
      {
        caseId: 'persona-baseline-common-dns',
        candidateStatus: 'present',
        layer1ErrorCount: 0,
        layer1WarnCount: 1,
        quarantined: false,
      },
    ],
  });
  assert.equal(artifact.mode, 'dry-run');
  assert.equal(artifact.judge.status, 'skipped');
  assert.equal(artifact.cases[0]?.judge, null);
  assert.equal('score' in artifact, false);
});

test('runEvalSmoke --dry-run: green on repo smoke set without secrets or network', () => {
  const result = runEvalSmoke({
    dryRun: true,
    json: true,
    repoRoot,
    smokeManifest: path.join(repoRoot, 'eval/smoke-manifest.json'),
    smokeQuarantine: path.join(repoRoot, 'eval/smoke-quarantine.json'),
    baselinesDir: path.join(repoRoot, 'eval/baselines'),
    goldenDir: path.join(repoRoot, 'eval/golden/cases'),
    skillVersion: '0.2.0',
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.artifact.mode, 'dry-run');
  assert.equal(result.artifact.judge.status, 'skipped');
  assert.ok(result.artifact.cases.length >= 6);
  assert.ok(result.artifact.cases.some((c) => c.candidateStatus === 'present'));
  assert.ok(result.artifact.cases.some((c) => c.candidateStatus === 'missing'));
});

test('runEvalSmoke: invalid smoke manifest fails closed', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'im-dumb-eval-'));
  const badManifest = path.join(dir, 'smoke.json');
  writeFileSync(badManifest, JSON.stringify({ version: 1, case_ids: [] }), 'utf8');
  const result = runEvalSmoke({
    dryRun: true,
    json: true,
    repoRoot,
    smokeManifest: badManifest,
    smokeQuarantine: path.join(repoRoot, 'eval/smoke-quarantine.json'),
    baselinesDir: path.join(repoRoot, 'eval/baselines'),
    goldenDir: path.join(repoRoot, 'eval/golden/cases'),
    skillVersion: '0.2.0',
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.error ?? '', /case_ids|non-empty/i);
});
