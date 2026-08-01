import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  JUDGE_TEMPERATURE,
  createMockJudgeClient,
  parseJudgePin,
  parseJudgeVerdict,
  type JudgePin,
  type JudgeRequest,
} from '../src/judge-client.ts';

const PIN: JudgePin = {
  modelId: 'judge-model',
  modelVersion: '2026-08-01',
  apiKey: 'test-key',
};

const REQUEST: JudgeRequest = {
  caseId: 'persona-baseline-common-dns',
  candidateText: 'DNS turns names into numbers.',
  rubricName: 'm1',
  referenceFacts: ['DNS resolves names to IP addresses'],
  mustPreserve: ['IP address'],
};

test('JUDGE_TEMPERATURE is pinned at 0', () => {
  assert.equal(JUDGE_TEMPERATURE, 0);
});

test('parseJudgePin: requires model id/version/key and rejects generator collision', () => {
  assert.deepEqual(parseJudgePin({
    JUDGE_MODEL: 'judge-model',
    JUDGE_MODEL_VERSION: '2026-08-01',
    JUDGE_API_KEY: 'secret',
  }), {
    modelId: 'judge-model',
    modelVersion: '2026-08-01',
    apiKey: 'secret',
  });

  assert.throws(
    () => parseJudgePin({ JUDGE_MODEL: 'same', JUDGE_MODEL_VERSION: 'v1', JUDGE_API_KEY: 'k', GENERATOR_MODEL: 'same' }),
    /must differ/i,
  );
  assert.throws(() => parseJudgePin({ JUDGE_MODEL: 'm', JUDGE_MODEL_VERSION: 'v' }), /JUDGE_API_KEY/);
});

test('parseJudgeVerdict: requires all three dimensions; invalid JSON / missing dim fails', () => {
  const ok = parseJudgeVerdict({
    dimensions: {
      factual_fidelity: { pass: true, evidence: [] },
      constraint_compliance: { pass: true, evidence: [] },
      reader_follow_up_need: { pass: false, evidence: ['What is an IP?'] },
    },
  });
  assert.equal(ok.dimensions.reader_follow_up_need.pass, false);
  assert.deepEqual(ok.dimensions.reader_follow_up_need.evidence, ['What is an IP?']);

  assert.throws(() => parseJudgeVerdict({ dimensions: { factual_fidelity: { pass: true, evidence: [] } } }), /constraint_compliance/);
  assert.throws(() => parseJudgeVerdict('not-json-object'), /object/);
});

test('createMockJudgeClient: returns scripted verdicts and never touches network', async () => {
  let calls = 0;
  const client = createMockJudgeClient(async () => {
    calls += 1;
    return {
      dimensions: {
        factual_fidelity: { pass: true, evidence: [] },
        constraint_compliance: { pass: true, evidence: [] },
        reader_follow_up_need: { pass: true, evidence: [] },
      },
    };
  }, PIN);

  const verdict = await client.judge(REQUEST);
  assert.equal(verdict.dimensions.factual_fidelity.pass, true);
  assert.equal(calls, 1);
  assert.equal(client.pin.modelId, PIN.modelId);
  assert.equal(client.temperature, 0);
});

test('createMockJudgeClient: invalid scripted payload fails the trial (no silent pass)', async () => {
  const client = createMockJudgeClient(async () => ({ dimensions: {} }));
  await assert.rejects(() => client.judge(REQUEST, PIN), /factual_fidelity/);
});
