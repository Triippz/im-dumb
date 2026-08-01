import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateM2Cohort } from '../src/m2-cohort.ts';

const passing = (attempt: number, semanticPass = true) => ({
  attempt,
  allThresholdsPass: true,
  proseErrorCount: 0,
  suspiciousAttemptCount: 0,
  semanticPass,
});

test('M2 cohort accepts five hard passes with four semantic passes', () => {
  const result = evaluateM2Cohort([passing(40), passing(41), passing(42), passing(43), passing(44, false)]);
  assert.equal(result.hardPass, true);
  assert.equal(result.semanticPasses, 4);
  assert.equal(result.accepted, true);
});

test('M2 cohort rejects a hard failure or fewer than four semantic passes', () => {
  assert.equal(evaluateM2Cohort([
    passing(40), passing(41), passing(42), passing(43, false), passing(44, false),
  ]).accepted, false);
  assert.equal(evaluateM2Cohort([
    passing(40), passing(41), passing(42), passing(43),
    { ...passing(44), proseErrorCount: 1 },
  ]).accepted, false);
});

test('M2 cohort rejects a malformed trial set', () => {
  assert.throws(() => evaluateM2Cohort([passing(40)]), /exactly 5/);
  assert.throws(() => evaluateM2Cohort([passing(40), passing(40), passing(42), passing(43), passing(44)]), /unique integers/);
});
