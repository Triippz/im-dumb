import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { evaluateM2Cohort } from '../../src/m2-cohort.ts';

const root = path.resolve(import.meta.dirname, '../..');
const flag = (name: string): string => {
  const value = process.argv.at(process.argv.indexOf(name) + 1);
  if (!value) throw new Error(`missing ${name}`);
  return value;
};
const parseAttempts = (value: string): number[] => value.split(',').map((item) => Number(item.trim()));
const attempts = parseAttempts(flag('--attempts'));
const semanticPasses = new Set(parseAttempts(flag('--semantic-passes')));

const trials = await Promise.all(attempts.map(async (attempt) => {
  const file = path.join(root, 'eval', 'runtime', 'm2', `attempt-${attempt}-results.json`);
  const result = JSON.parse(await readFile(file, 'utf8')) as {
    runtime?: { all_thresholds_pass?: boolean; prose_error_count?: number; scenarios?: Array<{ suspicious_attempt_count?: number }> };
  };
  const runtime = result.runtime;
  if (!runtime) throw new Error(`attempt ${attempt}: missing runtime result`);
  return {
    attempt,
    allThresholdsPass: runtime.all_thresholds_pass === true,
    proseErrorCount: runtime.prose_error_count ?? Number.POSITIVE_INFINITY,
    suspiciousAttemptCount: runtime.scenarios?.reduce((total, scenario) => total + (scenario.suspicious_attempt_count ?? 0), 0) ?? Number.POSITIVE_INFINITY,
    semanticPass: semanticPasses.has(attempt),
  };
}));

const cohort = evaluateM2Cohort(trials);
console.log(JSON.stringify(cohort, null, 2));
process.exitCode = cohort.accepted ? 0 : 1;
