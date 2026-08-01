export const M2_COHORT_SIZE = 5;
export const M2_SEMANTIC_PASSES_REQUIRED = 4;

export interface M2CohortTrial {
  attempt: number;
  allThresholdsPass: boolean;
  proseErrorCount: number;
  suspiciousAttemptCount: number;
  semanticPass: boolean;
}

export interface M2CohortResult {
  attempts: number[];
  hardPass: boolean;
  semanticPasses: number;
  accepted: boolean;
}

/** Aggregates a predeclared, immutable five-attempt cohort; no sample selection. */
export function evaluateM2Cohort(trials: readonly M2CohortTrial[]): M2CohortResult {
  if (trials.length !== M2_COHORT_SIZE) {
    throw new Error(`M2 cohort requires exactly ${M2_COHORT_SIZE} trials`);
  }
  const attempts = trials.map((trial) => trial.attempt);
  if (!attempts.every(Number.isSafeInteger) || new Set(attempts).size !== attempts.length) {
    throw new Error('M2 cohort attempts must be unique integers');
  }

  const hardPass = trials.every((trial) =>
    trial.allThresholdsPass && trial.proseErrorCount === 0 && trial.suspiciousAttemptCount === 0,
  );
  const semanticPasses = trials.filter((trial) => trial.semanticPass).length;
  return {
    attempts,
    hardPass,
    semanticPasses,
    accepted: hardPass && semanticPasses >= M2_SEMANTIC_PASSES_REQUIRED,
  };
}
