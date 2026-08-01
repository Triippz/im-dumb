export const JUDGE_DIMENSIONS = [
  'factual_fidelity',
  'constraint_compliance',
  'reader_follow_up_need',
] as const;

export type JudgeDimension = (typeof JUDGE_DIMENSIONS)[number];

export const MIN_JUDGE_TRIALS = 3;
export const MAX_JUDGE_TRIALS = 5;
export const DEFAULT_TOLERANCE_RATE = 0.05;
export const DEFAULT_SIGNIFICANCE_ALPHA = 0.05;

export interface TrialVerdict {
  dimensions: Partial<Record<JudgeDimension, boolean>> & Record<string, boolean>;
}

export interface DimensionAggregate {
  passes: number;
  trials: number;
  rate: number;
}

export interface CaseAggregate {
  caseId: string;
  trialCount: number;
  dimensions: Record<JudgeDimension, DimensionAggregate>;
  overallPasses: number;
  overallRate: number;
  quarantined: boolean;
}

export interface ProportionTestResult {
  z: number;
  pValue: number;
}

export interface WelchTestResult {
  t: number;
  df: number;
  pValue: number;
}

function assertTrialCount(count: number): void {
  if (count < MIN_JUDGE_TRIALS || count > MAX_JUDGE_TRIALS) {
    throw new Error(
      `trial count must be between ${MIN_JUDGE_TRIALS} and ${MAX_JUDGE_TRIALS} (got ${count})`,
    );
  }
}

function requireDimension(trial: TrialVerdict, dimension: JudgeDimension, index: number): boolean {
  const value = trial.dimensions[dimension];
  if (typeof value !== 'boolean') {
    throw new Error(`trial ${index}: missing boolean dimension "${dimension}"`);
  }
  return value;
}

export function aggregateCaseTrials(options: {
  caseId: string;
  trials: readonly TrialVerdict[];
  quarantined: boolean;
}): CaseAggregate {
  assertTrialCount(options.trials.length);

  const dimensions = Object.fromEntries(
    JUDGE_DIMENSIONS.map((dimension) => [dimension, { passes: 0, trials: 0, rate: 0 }]),
  ) as Record<JudgeDimension, DimensionAggregate>;

  let overallPasses = 0;
  options.trials.forEach((trial, index) => {
    let allPassed = true;
    for (const dimension of JUDGE_DIMENSIONS) {
      const passed = requireDimension(trial, dimension, index);
      dimensions[dimension].trials += 1;
      if (passed) dimensions[dimension].passes += 1;
      else allPassed = false;
    }
    if (allPassed) overallPasses += 1;
  });

  for (const dimension of JUDGE_DIMENSIONS) {
    const entry = dimensions[dimension];
    entry.rate = entry.passes / entry.trials;
  }

  return {
    caseId: options.caseId,
    trialCount: options.trials.length,
    dimensions,
    overallPasses,
    overallRate: overallPasses / options.trials.length,
    quarantined: options.quarantined,
  };
}

/** Approximate erf via Abramowitz & Stegun 7.1.26 — enough for gate p-values. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t) *
      Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function twoSidedPFromZ(z: number): number {
  return 2 * (1 - normalCdf(Math.abs(z)));
}

export function twoProportionZTest(
  successA: number,
  nA: number,
  successB: number,
  nB: number,
): ProportionTestResult {
  if (nA <= 0 || nB <= 0) {
    throw new Error('twoProportionZTest: sample sizes must be positive');
  }
  const pA = successA / nA;
  const pB = successB / nB;
  const pooled = (successA + successB) / (nA + nB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  if (se === 0) {
    return { z: 0, pValue: 1 };
  }
  const z = (pA - pB) / se;
  return { z, pValue: twoSidedPFromZ(z) };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleVariance(values: readonly number[], sampleMean: number): number {
  if (values.length < 2) return 0;
  return values.reduce((sum, value) => sum + (value - sampleMean) ** 2, 0) / (values.length - 1);
}

export function welchTTest(a: readonly number[], b: readonly number[]): WelchTestResult {
  if (a.length < 2 || b.length < 2) {
    throw new Error('welchTTest: each sample needs at least 2 observations');
  }
  const meanA = mean(a);
  const meanB = mean(b);
  const varA = sampleVariance(a, meanA);
  const varB = sampleVariance(b, meanB);
  const se2 = varA / a.length + varB / b.length;
  if (se2 === 0) {
    return { t: 0, df: a.length + b.length - 2, pValue: 1 };
  }
  const t = (meanA - meanB) / Math.sqrt(se2);
  const numerator = se2 ** 2;
  const denominator =
    (varA / a.length) ** 2 / (a.length - 1) + (varB / b.length) ** 2 / (b.length - 1);
  const df = denominator === 0 ? a.length + b.length - 2 : numerator / denominator;
  // Normal approximation for two-sided p; fine for gate tables with df ≳ 3.
  return { t, df, pValue: twoSidedPFromZ(t) };
}

export function isBlockingRegression(options: {
  baselinePasses: number;
  baselineTrials: number;
  candidatePasses: number;
  candidateTrials: number;
  tolerance: number;
  alpha: number;
}): boolean {
  if (options.baselineTrials <= 0 || options.candidateTrials <= 0) {
    throw new Error('isBlockingRegression: trial counts must be positive');
  }
  const baselineRate = options.baselinePasses / options.baselineTrials;
  const candidateRate = options.candidatePasses / options.candidateTrials;
  const drop = baselineRate - candidateRate;
  if (drop <= options.tolerance) {
    return false;
  }
  const { z, pValue } = twoProportionZTest(
    options.baselinePasses,
    options.baselineTrials,
    options.candidatePasses,
    options.candidateTrials,
  );
  // One-sided: candidate worse than baseline (positive z from A-B).
  const oneSidedP = z > 0 ? pValue / 2 : 1 - pValue / 2;
  return oneSidedP < options.alpha;
}
