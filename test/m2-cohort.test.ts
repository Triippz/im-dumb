import assert from 'node:assert/strict';
import { test } from 'node:test';

import { M2_CLEAN_TRIALS_REQUIRED, M2_COHORT_SIZE, evaluateM2Cohort } from '../src/m2-cohort.ts';

const passing = (attempt: number, semanticPass = true) => ({
  attempt,
  allThresholdsPass: true,
  proseErrorCount: 0,
  suspiciousAttemptCount: 0,
  semanticPass,
});

test('M2 cohort meets the threshold with four clean trials and four semantic passes', () => {
  const result = evaluateM2Cohort([passing(40), passing(41), passing(42), passing(43), passing(44, false)]);
  assert.equal(result.cleanTrials, 5);
  assert.equal(result.semanticPasses, 4);
  assert.equal(result.meetsThreshold, true);
});

test('M2 cohort tolerates one unclean trial but not two', () => {
  assert.equal;
  assert.equal;
  const oneUnclean = evaluateM2Cohort([
    passing(40), passing(41), passing(42), passing(43),
    { ...passing(44), proseErrorCount: 1 },
  ]);
  assert.equal(oneUnclean.cleanTrials, 4);
  assert.equal(oneUnclean.meetsThreshold, true);

  assert.equal(evaluateM2Cohort([
    passing(40), passing(41), passing(42),
    { ...passing(43), allThresholdsPass: false },
    { ...passing(44), suspiciousAttemptCount: 1 },
  ]).meetsThreshold, false);
});

test('M2 cohort rejects fewer than four semantic passes', () => {
  assert.equal(evaluateM2Cohort([
    passing(40), passing(41), passing(42), passing(43, false), passing(44, false),
  ]).meetsThreshold, false);
});

test('M2 cohort rejects a malformed trial set', () => {
  assert.throws(() => evaluateM2Cohort([passing(40)]), /exactly 5/);
  assert.throws(() => evaluateM2Cohort([passing(40), passing(40), passing(42), passing(43), passing(44)]), /unique integers/);
});
