import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const captureSource = readFileSync(path.join(repoRoot, 'eval', 'runtime', 'capture-m2.ts'), 'utf8');

test('M2 harness prompt supplies paths, not the diagnosis behavior being evaluated', () => {
  const prompt = captureSource.match(/const harnessPrompt = `([\s\S]*?)`;/)?.[1] ?? '';
  assert.match(prompt, /Resolve every relative path/i);
  assert.match(prompt, /Run profile commands/i);
  assert.match(prompt, /Read references/i);
  assert.doesNotMatch(prompt, /first line|Likely confusion points|Never start|Never narrate/i);
});

test('M2 capture provenance gives every run an id and links only scenario-specific infrastructure retries', () => {
  assert.match(captureSource, /const captureRunId = randomUUID\(\)/);
  assert.match(captureSource, /function priorInfrastructureFailure\(scenario: string\)/);
  assert.match(captureSource, /fresh_run_id: captureRunId/);
  assert.match(captureSource, /retry_of: retryOf/);
  assert.match(captureSource, /rerun: retryOf !== null/);
});
