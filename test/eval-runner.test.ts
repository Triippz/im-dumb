import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { MIN_JUDGE_TRIALS } from '../src/eval-aggregate.ts';
import {
  buildDryRunArtifact,
  parseEvalRunnerArgs,
  runEvalSmoke,
  runEvalSmokeAsync,
} from '../src/eval-runner.ts';
import { createMockJudgeClient } from '../src/judge-client.ts';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');

function dryArgs(overrides: Partial<Parameters<typeof runEvalSmoke>[0]> = {}) {
  return {
    dryRun: true as const,
    json: true,
    repoRoot,
    smokeManifest: path.join(repoRoot, 'eval/smoke-manifest.json'),
    smokeQuarantine: path.join(repoRoot, 'eval/smoke-quarantine.json'),
    baselinesDir: path.join(repoRoot, 'eval/baselines'),
    goldenDir: path.join(repoRoot, 'eval/golden/cases'),
    skillVersion: '0.2.0',
    trialsPerCase: MIN_JUDGE_TRIALS,
    ...overrides,
  };
}

const ALL_PASS = {
  dimensions: {
    factual_fidelity: { pass: true, evidence: [] },
    constraint_compliance: { pass: true, evidence: [] },
    reader_follow_up_need: { pass: true, evidence: [] },
  },
};

test('parseEvalRunnerArgs: defaults to dry-run and repo eval paths', () => {
  const args = parseEvalRunnerArgs([]);
  assert.equal(args.dryRun, true);
  assert.equal(args.json, false);
  assert.equal(args.trialsPerCase, MIN_JUDGE_TRIALS);
  assert.match(args.smokeManifest, /smoke-manifest\.json$/);
});

test('parseEvalRunnerArgs: --live requires explicit opt-in (still needs pin at run time)', () => {
  const args = parseEvalRunnerArgs(['--live', '--json', '--trials', '4']);
  assert.equal(args.dryRun, false);
  assert.equal(args.json, true);
  assert.equal(args.trialsPerCase, 4);
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
  const result = runEvalSmoke(dryArgs());
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
  const result = runEvalSmoke(dryArgs({ smokeManifest: badManifest }));
  assert.equal(result.exitCode, 1);
  assert.match(result.error ?? '', /case_ids|non-empty/i);
});

test('runEvalSmokeAsync --live with mock: judges present Layer-1-clean candidates', async () => {
  let judgeCalls = 0;
  const client = createMockJudgeClient(async () => {
    judgeCalls += 1;
    return ALL_PASS;
  });

  const result = await runEvalSmokeAsync(
    dryArgs({
      dryRun: false,
      judgeClient: client,
      trialsPerCase: MIN_JUDGE_TRIALS,
    }),
  );

  assert.equal(result.artifact.mode, 'live');
  assert.equal(result.artifact.judge.status, 'ran');
  if (result.artifact.judge.status === 'ran') {
    assert.equal(result.artifact.judge.temperature, 0);
    assert.equal(result.artifact.judge.trialsPerCase, MIN_JUDGE_TRIALS);
  }

  const presentClean = result.artifact.cases.filter(
    (c) => c.candidateStatus === 'present' && c.layer1ErrorCount === 0,
  );
  assert.ok(presentClean.length >= 1);
  for (const item of presentClean) {
    assert.equal(item.judge?.passed, true);
    assert.equal(item.judge?.trialCount, MIN_JUDGE_TRIALS);
  }

  const missing = result.artifact.cases.filter((c) => c.candidateStatus === 'missing');
  assert.ok(missing.length >= 1);
  for (const item of missing) {
    assert.equal(item.judge?.passed, false);
    assert.equal(item.judge?.reason, 'candidate missing');
  }

  const layer1Fails = result.artifact.cases.filter(
    (c) => c.candidateStatus === 'present' && c.layer1ErrorCount > 0,
  );
  for (const item of layer1Fails) {
    assert.equal(item.judge?.passed, false);
    assert.equal(item.judge?.reason, 'layer1 errors');
  }

  assert.equal(judgeCalls, presentClean.length * MIN_JUDGE_TRIALS);
  // Missing candidates + Layer1 failures make live exit non-zero until fixtures cover smoke set.
  assert.ok(result.artifact.failedBlockingCaseIds.length > 0);
  assert.equal(result.exitCode, 1);
});

test('runEvalSmokeAsync --live: missing pin fails closed without inventing passes', async () => {
  const result = await runEvalSmokeAsync(
    dryArgs({
      dryRun: false,
      env: {},
    }),
  );
  assert.equal(result.exitCode, 1);
  assert.match(result.error ?? '', /JUDGE_API_KEY|judge pin/i);
  assert.equal(result.artifact.cases.length, 0);
});
