import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_SIGNIFICANCE_ALPHA,
  DEFAULT_TOLERANCE_RATE,
  JUDGE_DIMENSIONS,
  MIN_JUDGE_TRIALS,
  aggregateCaseTrials,
  isBlockingRegression,
  twoProportionZTest,
  welchTTest,
  type TrialVerdict,
} from '../src/eval-aggregate.ts';

const ALL_PASS: TrialVerdict = {
  dimensions: {
    factual_fidelity: true,
    constraint_compliance: true,
    reader_follow_up_need: true,
  },
};

const FIDELITY_FAIL: TrialVerdict = {
  dimensions: {
    factual_fidelity: false,
    constraint_compliance: true,
    reader_follow_up_need: true,
  },
};

test('JUDGE_DIMENSIONS matches the M1 rubric contract (three separable dims)', () => {
  assert.deepEqual([...JUDGE_DIMENSIONS], [
    'factual_fidelity',
    'constraint_compliance',
    'reader_follow_up_need',
  ]);
});

test('aggregateCaseTrials: raw per-dimension rates, no collapsed score', () => {
  const report = aggregateCaseTrials({
    caseId: 'case-a',
    trials: [ALL_PASS, ALL_PASS, FIDELITY_FAIL],
    quarantined: false,
  });
  assert.equal(report.trialCount, 3);
  assert.equal(report.dimensions.factual_fidelity.passes, 2);
  assert.equal(report.dimensions.factual_fidelity.trials, 3);
  assert.equal(report.dimensions.factual_fidelity.rate, 2 / 3);
  assert.equal(report.overallPasses, 2);
  assert.equal(report.overallRate, 2 / 3);
  assert.equal(report.quarantined, false);
  assert.equal('score' in report, false);
});

test('aggregateCaseTrials: rejects trial counts outside 3–5 and missing dimensions', () => {
  assert.throws(
    () => aggregateCaseTrials({ caseId: 'x', trials: [ALL_PASS, ALL_PASS], quarantined: false }),
    new RegExp(String(MIN_JUDGE_TRIALS)),
  );
  assert.throws(
    () =>
      aggregateCaseTrials({
        caseId: 'x',
        trials: [
          ALL_PASS,
          ALL_PASS,
          { dimensions: { factual_fidelity: true, constraint_compliance: true } },
        ],
        quarantined: false,
      }),
    /reader_follow_up_need/,
  );
});

test('twoProportionZTest: equal rates → |z| near 0; clear drop → large |z|', () => {
  const equal = twoProportionZTest(8, 10, 8, 10);
  assert.ok(Math.abs(equal.z) < 0.01);
  assert.ok(equal.pValue > 0.9);

  const drop = twoProportionZTest(9, 10, 1, 10);
  assert.ok(drop.z > 2.5);
  assert.ok(drop.pValue < 0.01);
});

test('welchTTest: identical samples → |t| near 0; separated means → large |t|', () => {
  const same = welchTTest([1, 2, 3], [1, 2, 3]);
  assert.ok(Math.abs(same.t) < 0.01);
  assert.ok(same.pValue > 0.9);

  const separated = welchTTest([10, 11, 12, 13], [1, 2, 3, 4]);
  assert.ok(Math.abs(separated.t) > 5);
  assert.ok(separated.pValue < 0.01);
});

test('isBlockingRegression: inside tolerance never blocks', () => {
  assert.equal(
    isBlockingRegression({
      baselinePasses: 10,
      baselineTrials: 10,
      candidatePasses: 9,
      candidateTrials: 10,
      tolerance: DEFAULT_TOLERANCE_RATE,
      alpha: DEFAULT_SIGNIFICANCE_ALPHA,
    }),
    false,
  );
});

test('isBlockingRegression: large significant drop blocks; small sample drop does not', () => {
  assert.equal(
    isBlockingRegression({
      baselinePasses: 95,
      baselineTrials: 100,
      candidatePasses: 40,
      candidateTrials: 100,
      tolerance: DEFAULT_TOLERANCE_RATE,
      alpha: DEFAULT_SIGNIFICANCE_ALPHA,
    }),
    true,
  );

  // Outside a tiny tolerance, but n is too small for significance at alpha=0.05.
  assert.equal(
    isBlockingRegression({
      baselinePasses: 3,
      baselineTrials: 3,
      candidatePasses: 2,
      candidateTrials: 3,
      tolerance: 0,
      alpha: DEFAULT_SIGNIFICANCE_ALPHA,
    }),
    false,
  );
});
