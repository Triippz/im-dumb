import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');

test('M2 evaluator rejects an invalid attempt instead of silently using the default evidence', () => {
  const result = spawnSync('node', ['eval/runtime/evaluate-m2.ts'], {
    cwd: repoRoot,
    env: { ...process.env, IM_DUMB_CAPTURE_ATTEMPT: '0' },
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /IM_DUMB_CAPTURE_ATTEMPT must be a positive integer/);
});
