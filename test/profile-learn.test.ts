import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  PROFILE_LOCK_RETRY_MS,
  PROFILE_LOCK_STALE_MS,
  PROFILE_LOCK_SUFFIX,
  PROFILE_LOCK_TIMEOUT_MS,
  learn,
  save,
  type LearnGapInput,
} from '../src/profile.ts';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const sourceScript = path.join(repoRoot, 'src', 'profile.ts');

const FULL_PROFILE = {
  schema_version: 1,
  vocabulary_level: 'technical-ok',
  jargon_policy: 'avoid',
  sentence_length_cap: 25,
  paragraph_topic_limit: 2,
  tone: 'friendly',
  output_shape: 'narrative',
  adhd_mode: true,
  known_gap_types: [] as Array<{ type: string; confidence: number }>,
  forbidden_phrases: ['synergy'],
  learning_asset_preferences: { formats: ['markdown'] },
};

function freshProfilePath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'im-dumb-learn-'));
  return path.join(dir, 'profile.json');
}

function seed(profilePath: string, value: unknown = FULL_PROFILE): void {
  mkdirSync(path.dirname(profilePath), { recursive: true });
  writeFileSync(profilePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function withProfilePath<T>(profilePath: string, fn: () => T): T {
  const before = process.env.IM_DUMB_PROFILE;
  process.env.IM_DUMB_PROFILE = profilePath;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.IM_DUMB_PROFILE;
    else process.env.IM_DUMB_PROFILE = before;
  }
}

function readProfile(profilePath: string): typeof FULL_PROFILE {
  return JSON.parse(readFileSync(profilePath, 'utf8')) as typeof FULL_PROFILE;
}

function input(overrides: Partial<LearnGapInput> = {}): LearnGapInput {
  return { type: 'term', outcome: 'success', expectedConfidence: null, ...overrides };
}

function foreignLock(profilePath: string, record: unknown): string {
  const lockPath = `${profilePath}${PROFILE_LOCK_SUFFIX}`;
  mkdirSync(path.dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return lockPath;
}

function reclaimCandidate(lockPath: string, overrides: Partial<{ token: string; pid: number; createdAt: number }> = {}) {
  const record = { token: randomUUID(), pid: process.pid, createdAt: Date.now(), ...overrides };
  const candidatePath = `${lockPath}.reclaim.${record.createdAt}.${record.pid}.${record.token}`;
  writeFileSync(candidatePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return { path: candidatePath, record, linkPath: `${candidatePath}.main-link` };
}

function cli(profilePath: string, command: string, stdin = '') {
  return spawnSync(process.execPath, [sourceScript, command], {
    env: { ...process.env, IM_DUMB_PROFILE: profilePath },
    input: stdin,
    encoding: 'utf8',
  });
}

test('M2 lock constants and private exclusive-create mode are the frozen contract', () => {
  assert.equal(PROFILE_LOCK_SUFFIX, '.lock');
  assert.equal(PROFILE_LOCK_RETRY_MS, 25);
  assert.equal(PROFILE_LOCK_TIMEOUT_MS, 500);
  assert.equal(PROFILE_LOCK_STALE_MS, 30_000);
  const source = readFileSync(sourceScript, 'utf8');
  assert.match(source, /const token = randomUUID\(\)/u);
  assert.match(source, /const deadline = performance\.now\(\) \+ PROFILE_LOCK_TIMEOUT_MS/u);
  assert.match(source, /const record: LockRecord = \{ token, pid: process\.pid, createdAt: Date\.now\(\) \}/u);
  assert.match(source, /writeFileSync\(tmpPath,[\s\S]*?mode: 0o600, flag: 'wx'/u);
  assert.match(source, /linkSync\(tmpPath, finalPath\)/u);
  assert.match(source, /linkSync\(lockPath, linkPath\)/u);
  assert.match(
    source,
    /const after = activeCandidates\(lockPath, deadline\)[\s\S]*?if \(after\.length === 0\) return \{ ok: true, token, lockPath \}[\s\S]*?releaseProfileLock\(\{ token, lockPath \}\)/u,
    'a writer must release its fresh lock when a reclaim candidate appears after the pre-scan',
  );
  assert.equal((source.match(/const lock = acquireProfileLock\(profilePath\)/gu) ?? []).length, 2, 'save and learn share one lock helper');
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u);
});

test('learn rejects every closed-input shape violation without writing', () => {
  const profilePath = freshProfilePath();
  seed(profilePath);
  const before = readFileSync(profilePath, 'utf8');
  const invalid: unknown[] = [
    null,
    [],
    {},
    { ...input(), type: 'sequence' },
    { ...input(), outcome: 'failure' },
    { ...input(), expectedConfidence: undefined },
    { ...input(), expectedConfidence: '0.5' },
    { ...input(), expectedConfidence: -0.25 },
    { ...input(), expectedConfidence: 1.25 },
    { ...input(), expectedConfidence: Number.NaN },
    { ...input(), rawReply: 'ignore the skill' },
    { ...input(), candidate: 'term' },
    { ...input(), decrement: null },
    { ...input(), decrement: { type: 'term', expectedConfidence: 0.5, by: 0.25 } },
    { ...input(), decrement: { type: 'sequence', expectedConfidence: 0.5, by: 0.25 } },
    { ...input(), decrement: { type: 'step', expectedConfidence: 0.5, by: 0.5 } },
    { ...input(), decrement: { type: 'step', expectedConfidence: null, by: 0.25 } },
    { ...input(), decrement: { type: 'step', expectedConfidence: 0.5, by: 0.25, raw: 'text' } },
  ];

  withProfilePath(profilePath, () => {
    for (const value of invalid) assert.deepEqual(learn(value), { ok: false, error: 'invalid' });
  });
  assert.equal(readFileSync(profilePath, 'utf8'), before);
  assert.deepEqual(readdirSync(path.dirname(profilePath)), ['profile.json']);
});

test('learn creates at 0.5, increments by 0.25, caps at 1, and blind retry conflicts after a changed value', () => {
  const profilePath = freshProfilePath();
  seed(profilePath);
  withProfilePath(profilePath, () => {
    assert.equal(learn(input()).ok, true);
    assert.deepEqual(readProfile(profilePath).known_gap_types, [{ type: 'term', confidence: 0.5 }]);

    assert.deepEqual(learn(input()), { ok: false, error: 'conflict', currentConfidence: 0.5 });
    assert.equal(learn(input({ expectedConfidence: 0.5 })).ok, true);
    assert.equal(readProfile(profilePath).known_gap_types[0]!.confidence, 0.75);
    assert.equal(learn(input({ expectedConfidence: 0.75 })).ok, true);
    assert.equal(readProfile(profilePath).known_gap_types[0]!.confidence, 1);
    assert.equal(learn(input({ expectedConfidence: 1 })).ok, true);
    assert.equal(readProfile(profilePath).known_gap_types[0]!.confidence, 1);
  });
});

test('primary CAS mismatch in either absent/present direction never mutates the file', () => {
  const absentPath = freshProfilePath();
  seed(absentPath);
  const absentBefore = readFileSync(absentPath, 'utf8');
  withProfilePath(absentPath, () => {
    assert.deepEqual(learn(input({ expectedConfidence: 0.5 })), {
      ok: false,
      error: 'conflict',
      currentConfidence: null,
    });
  });
  assert.equal(readFileSync(absentPath, 'utf8'), absentBefore);

  const profilePath = freshProfilePath();
  seed(profilePath, { ...FULL_PROFILE, known_gap_types: [{ type: 'term', confidence: 0.75 }] });
  const before = readFileSync(profilePath, 'utf8');
  withProfilePath(profilePath, () => {
    assert.deepEqual(learn(input({ expectedConfidence: null })), {
      ok: false,
      error: 'conflict',
      currentConfidence: 0.75,
    });
    assert.deepEqual(learn(input({ expectedConfidence: 0.5 })), {
      ok: false,
      error: 'conflict',
      currentConfidence: 0.75,
    });
  });
  assert.equal(readFileSync(profilePath, 'utf8'), before);
});

test('paired update applies primary and decrement atomically, including decrement floor zero', () => {
  const profilePath = freshProfilePath();
  seed(profilePath, { ...FULL_PROFILE, known_gap_types: [{ type: 'framing', confidence: 1 }] });
  withProfilePath(profilePath, () => {
    const result = learn(input({
      type: 'step',
      decrement: { type: 'framing', expectedConfidence: 1, by: 0.25 },
    }));
    assert.equal(result.ok, true);
    assert.deepEqual(readProfile(profilePath).known_gap_types, [
      { type: 'framing', confidence: 0.75 },
      { type: 'step', confidence: 0.5 },
    ]);

    for (const expected of [0.5, 0.25, 0, 0]) {
      const current = readProfile(profilePath).known_gap_types.find((gap) => gap.type === 'framing')!.confidence;
      const next = learn(input({
        type: 'term',
        expectedConfidence: readProfile(profilePath).known_gap_types.find((gap) => gap.type === 'term')?.confidence ?? null,
        decrement: { type: 'framing', expectedConfidence: current, by: 0.25 },
      }));
      assert.equal(next.ok, true);
      assert.equal(readProfile(profilePath).known_gap_types.find((gap) => gap.type === 'framing')!.confidence, expected);
    }
  });
});

test('decrement CAS conflict is all-or-nothing and reports the decrement current confidence', () => {
  const profilePath = freshProfilePath();
  seed(profilePath, {
    ...FULL_PROFILE,
    known_gap_types: [{ type: 'term', confidence: 0.5 }, { type: 'framing', confidence: 1 }],
  });
  const before = readFileSync(profilePath, 'utf8');
  withProfilePath(profilePath, () => {
    assert.deepEqual(learn(input({
      expectedConfidence: 0.5,
      decrement: { type: 'framing', expectedConfidence: 0.75, by: 0.25 },
    })), { ok: false, error: 'conflict', currentConfidence: 1 });
  });
  assert.equal(readFileSync(profilePath, 'utf8'), before);
});

test('decrement against an absent type conflicts with null and writes neither transition', () => {
  const profilePath = freshProfilePath();
  seed(profilePath);
  const before = readFileSync(profilePath, 'utf8');
  withProfilePath(profilePath, () => {
    assert.deepEqual(learn(input({
      decrement: { type: 'step', expectedConfidence: 0.5, by: 0.25 },
    })), { ok: false, error: 'conflict', currentConfidence: null });
  });
  assert.equal(readFileSync(profilePath, 'utf8'), before);
});

test('learn preflight returns missing without creating an absent parent directory', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'im-dumb-learn-missing-parent-'));
  const profilePath = path.join(root, 'absent', 'nested', 'profile.json');
  assert.equal(existsSync(path.dirname(profilePath)), false);
  withProfilePath(profilePath, () => assert.deepEqual(learn(input()), { ok: false, error: 'missing' }));
  assert.equal(existsSync(path.dirname(profilePath)), false);
  assert.deepEqual(readdirSync(root), []);
});

test('learn with an empty IM_DUMB_PROFILE returns env-path-invalid without artifacts', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'im-dumb-learn-empty-env-'));
  const before = process.env.IM_DUMB_PROFILE;
  const beforeHome = process.env.HOME;
  process.env.IM_DUMB_PROFILE = '';
  process.env.HOME = root;
  try {
    assert.deepEqual(learn(input()), { ok: false, error: 'env-path-invalid' });
  } finally {
    if (before === undefined) delete process.env.IM_DUMB_PROFILE;
    else process.env.IM_DUMB_PROFILE = before;
    if (beforeHome === undefined) delete process.env.HOME;
    else process.env.HOME = beforeHome;
  }
  assert.deepEqual(readdirSync(root), []);
});

test('learn strictly rejects missing, malformed, unsupported, incomplete, invalid, and duplicate profiles without rewriting', () => {
  const scenarios: Array<[string, string | undefined, string]> = [
    ['missing', undefined, 'missing'],
    ['malformed', '{ nope', 'unparseable'],
    ['unsupported', JSON.stringify({ ...FULL_PROFILE, schema_version: 2 }), 'unsupported-schema-version'],
    ['incomplete', JSON.stringify({ schema_version: 1 }), 'invalid'],
    ['invalid unrelated field', JSON.stringify({ ...FULL_PROFILE, tone: 'sarcastic' }), 'invalid'],
    ['unknown top-level field', JSON.stringify({ ...FULL_PROFILE, extra: true }), 'invalid'],
    ['recognized duplicate', JSON.stringify({ ...FULL_PROFILE, known_gap_types: [
      { type: 'term', confidence: 0.5 }, { type: 'term', confidence: 0.75 },
    ] }), 'invalid'],
  ];

  for (const [name, contents, expected] of scenarios) {
    const profilePath = freshProfilePath();
    if (contents !== undefined) {
      mkdirSync(path.dirname(profilePath), { recursive: true });
      writeFileSync(profilePath, contents, 'utf8');
    }
    const before = contents === undefined ? undefined : readFileSync(profilePath, 'utf8');
    withProfilePath(profilePath, () => {
      const result = learn(input());
      assert.equal(result.ok, false, name);
      if (!result.ok) assert.equal(result.error, expected, name);
    });
    if (before !== undefined) assert.equal(readFileSync(profilePath, 'utf8'), before, name);
    assert.equal(existsSync(`${profilePath}${PROFILE_LOCK_SUFFIX}`), false, name);
  }
});

test('unknown gap entries and unrelated valid profile fields survive value-for-value', () => {
  const profilePath = freshProfilePath();
  const unknown = { type: 'sequence', confidence: 0.6 };
  const profile = {
    ...FULL_PROFILE,
    tone: 'neutral',
    sentence_length_cap: 37,
    known_gap_types: [unknown, { type: 'term', confidence: 0.5 }],
  };
  seed(profilePath, profile);
  withProfilePath(profilePath, () => {
    assert.equal(learn(input({ expectedConfidence: 0.5 })).ok, true);
  });
  const saved = readProfile(profilePath);
  assert.deepEqual(saved.known_gap_types[0], unknown);
  assert.equal(saved.known_gap_types[1]!.confidence, 0.75);
  assert.equal(saved.tone, 'neutral');
  assert.equal(saved.sentence_length_cap, 37);
  assert.deepEqual(saved.forbidden_phrases, ['synergy']);
});

test('save and learn time out behind a live foreign lock and never remove it', () => {
  const profilePath = freshProfilePath();
  seed(profilePath);
  const lockPath = foreignLock(profilePath, { token: 'foreign-live', pid: process.pid, createdAt: 0 });
  const before = readFileSync(lockPath, 'utf8');
  withProfilePath(profilePath, () => {
    assert.deepEqual(save(FULL_PROFILE), { ok: false, error: 'lock-timeout' });
    assert.deepEqual(learn(input()), { ok: false, error: 'lock-timeout' });
  });
  assert.equal(readFileSync(lockPath, 'utf8'), before);
});

test('invalid PID and EPERM stale locks remain and time out', () => {
  for (const record of [
    { token: 'invalid-pid', pid: 0, createdAt: 0 },
    { token: 'invalid-shape', pid: 'nope', createdAt: 0 },
  ]) {
    const profilePath = freshProfilePath();
    seed(profilePath);
    const lockPath = foreignLock(profilePath, record);
    withProfilePath(profilePath, () => assert.deepEqual(learn(input()), { ok: false, error: 'lock-timeout' }));
    assert.ok(existsSync(lockPath));
  }

  const profilePath = freshProfilePath();
  seed(profilePath);
  const lockPath = foreignLock(profilePath, { token: 'eperm', pid: 12345, createdAt: 0 });
  const originalKill = process.kill;
  process.kill = (() => {
    const error = new Error('denied') as NodeJS.ErrnoException;
    error.code = 'EPERM';
    throw error;
  }) as typeof process.kill;
  try {
    withProfilePath(profilePath, () => assert.deepEqual(learn(input()), { ok: false, error: 'lock-timeout' }));
  } finally {
    process.kill = originalKill;
  }
  assert.ok(existsSync(lockPath));
});

test('stale reclamation cannot remove a replacement live lock', () => {
  const profilePath = freshProfilePath();
  seed(profilePath);
  const lockPath = foreignLock(profilePath, { token: 'first-owner', pid: 12345, createdAt: 0 });
  const replacement = { token: 'replacement-owner', pid: process.pid, createdAt: 0 };
  const originalKill = process.kill;
  let calls = 0;
  process.kill = ((pid: number, signal: NodeJS.Signals | number) => {
    calls++;
    if (calls === 1) {
      unlinkSync(lockPath);
      writeFileSync(lockPath, `${JSON.stringify(replacement)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      const error = new Error('gone') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    }
    return originalKill(pid, signal);
  }) as typeof process.kill;
  try {
    withProfilePath(profilePath, () => assert.deepEqual(learn(input()), { ok: false, error: 'lock-timeout' }));
  } finally {
    process.kill = originalKill;
  }
  assert.deepEqual(JSON.parse(readFileSync(lockPath, 'utf8')), replacement);
  assert.equal(readdirSync(path.dirname(profilePath)).some((name) => name.includes('.reclaim.')), false);
});

test('malformed reclaim-like filenames and mismatched records are not valid ownership candidates', () => {
  const profilePath = freshProfilePath();
  seed(profilePath);
  const lockPath = `${profilePath}${PROFILE_LOCK_SUFFIX}`;
  const malformed = `${lockPath}.reclaim.not-a-candidate`;
  const mismatchRecord = { token: randomUUID(), pid: process.pid, createdAt: Date.now() };
  const mismatched = `${lockPath}.reclaim.${mismatchRecord.createdAt}.${mismatchRecord.pid}.${randomUUID()}`;
  writeFileSync(malformed, 'unrelated\n', { encoding: 'utf8', mode: 0o600 });
  writeFileSync(mismatched, `${JSON.stringify(mismatchRecord)}\n`, { encoding: 'utf8', mode: 0o600 });
  withProfilePath(profilePath, () => assert.equal(learn(input()).ok, true));
  assert.ok(existsSync(malformed));
  assert.ok(existsSync(mismatched));
  assert.equal(existsSync(lockPath), false);
});

test('a foreign reclaim claim bounds acquisition time and remains untouched on timeout', () => {
  const profilePath = freshProfilePath();
  seed(profilePath);
  const lockPath = foreignLock(profilePath, {
    token: 'stale-looking',
    pid: 2_147_483_647,
    createdAt: Date.now() - PROFILE_LOCK_STALE_MS - 1_000,
  });
  const candidate = reclaimCandidate(lockPath, { createdAt: 0 });
  const lockBefore = readFileSync(lockPath, 'utf8');
  const claimBefore = readFileSync(candidate.path, 'utf8');
  const started = Date.now();
  withProfilePath(profilePath, () => assert.deepEqual(learn(input()), { ok: false, error: 'lock-timeout' }));
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= PROFILE_LOCK_TIMEOUT_MS, `returned before timeout: ${elapsed}ms`);
  assert.ok(elapsed < PROFILE_LOCK_TIMEOUT_MS + 750, `timeout exceeded bound: ${elapsed}ms`);
  assert.equal(readFileSync(lockPath, 'utf8'), lockBefore);
  assert.equal(readFileSync(candidate.path, 'utf8'), claimBefore);
});

test('stale-looking lock churn plus reclaim contention still obeys the timeout bound', async () => {
  const profilePath = freshProfilePath();
  seed(profilePath);
  const lockPath = foreignLock(profilePath, {
    token: 'initial-churn-owner',
    pid: 2_147_483_647,
    createdAt: 0,
  });
  const candidate = reclaimCandidate(lockPath, { createdAt: 0 });
  const scriptPath = path.join(path.dirname(profilePath), 'churn.mjs');
  writeFileSync(scriptPath, [
    "import { renameSync, writeFileSync } from 'node:fs';",
    'const lockPath = process.argv[2];',
    'let generation = 0;',
    "setInterval(() => { const tmp = `${lockPath}.churn`; writeFileSync(tmp, `${JSON.stringify({ token: `churn-${generation++}`, pid: 2147483647, createdAt: 0 })}\\n`); renameSync(tmp, lockPath); }, 5);",
    "process.stdout.write('ready\\n');",
  ].join('\n'), 'utf8');
  const churn = spawn(process.execPath, [scriptPath, lockPath], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((resolve) => churn.stdout.once('data', () => resolve()));

  const started = Date.now();
  withProfilePath(profilePath, () => assert.deepEqual(learn(input()), { ok: false, error: 'lock-timeout' }));
  const elapsed = Date.now() - started;
  churn.kill();
  await new Promise<void>((resolve) => churn.once('close', () => resolve()));
  assert.ok(elapsed >= PROFILE_LOCK_TIMEOUT_MS, `returned before timeout: ${elapsed}ms`);
  assert.ok(elapsed < PROFILE_LOCK_TIMEOUT_MS + 750, `timeout exceeded bound: ${elapsed}ms`);
  assert.ok(existsSync(lockPath));
  assert.ok(existsSync(candidate.path));
});

test('stale crashed reclaim records recover at every crash window without deleting a replacement live main', () => {
  for (const window of ['before-link', 'after-link', 'after-main-unlink'] as const) {
    const profilePath = freshProfilePath();
    seed(profilePath);
    const old = { token: `old-main-${window}`, pid: 2_147_483_647, createdAt: 0 };
    const replacement = { token: `replacement-main-${window}`, pid: process.pid, createdAt: 0 };
    const lockPath = foreignLock(profilePath, window === 'after-main-unlink' ? old : replacement);
    const candidate = reclaimCandidate(lockPath, { pid: 2_147_483_647, createdAt: 0 });

    if (window === 'after-link') {
      linkSync(lockPath, candidate.linkPath);
    } else if (window === 'after-main-unlink') {
      linkSync(lockPath, candidate.linkPath);
      unlinkSync(lockPath);
      writeFileSync(lockPath, `${JSON.stringify(replacement)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    }

    withProfilePath(profilePath, () => assert.deepEqual(learn(input()), { ok: false, error: 'lock-timeout' }));
    assert.deepEqual(JSON.parse(readFileSync(lockPath, 'utf8')), replacement, window);
    assert.equal(existsSync(candidate.path), false, window);
    assert.equal(existsSync(candidate.linkPath), false, window);
  }
});

test('a stale lock with a dead PID is reclaimed; owned lock, claim, and temp files are cleaned', () => {
  const profilePath = freshProfilePath();
  seed(profilePath);
  const lockPath = foreignLock(profilePath, {
    token: 'dead-owner',
    pid: 2_147_483_647,
    createdAt: Date.now() - PROFILE_LOCK_STALE_MS - 1_000,
  });
  withProfilePath(profilePath, () => assert.equal(learn(input()).ok, true));
  assert.equal(existsSync(lockPath), false);
  assert.deepEqual(readdirSync(path.dirname(profilePath)), ['profile.json']);
  assert.equal(statSync(profilePath).mode & 0o777, 0o600);
});

test('dot-segment IM_DUMB_PROFILE paths normalize before stale-lock election', () => {
  const profilePath = freshProfilePath();
  seed(profilePath);
  foreignLock(profilePath, {
    token: 'dead-owner-dot-path',
    pid: 2_147_483_647,
    createdAt: Date.now() - PROFILE_LOCK_STALE_MS - 1_000,
  });
  const dottedPath = `${path.dirname(profilePath)}/./${path.basename(profilePath)}`;
  withProfilePath(dottedPath, () => assert.equal(learn(input()).ok, true));
  assert.equal(readProfile(profilePath).known_gap_types[0]?.confidence, 0.5);
});

test('late time- or token-ordered election candidates cannot expose a writer race', () => {
  for (const order of ['earlier-time', 'later-time', 'earlier-token', 'later-token'] as const) {
    const profilePath = freshProfilePath();
    seed(profilePath);
    const deadPid = 2_147_483_647;
    const originalMain = { token: `late-edge-main-${order}`, pid: deadPid, createdAt: 0 };
    const lockPath = foreignLock(profilePath, originalMain);
    const originalKill = process.kill;
    let deadChecks = 0;
    let late: ReturnType<typeof reclaimCandidate> | undefined;
    process.kill = ((pid: number, signal: NodeJS.Signals | number) => {
      if (pid === deadPid) {
        deadChecks++;
        if (deadChecks === 2) {
          const ownName = readdirSync(path.dirname(lockPath)).find((name) =>
            name.startsWith(`${path.basename(lockPath)}.reclaim.`) && !name.endsWith('.main-link'),
          )!;
          const own = JSON.parse(readFileSync(path.join(path.dirname(lockPath), ownName), 'utf8')) as {
            createdAt: number;
          };
          const earlier = order.startsWith('earlier');
          late = reclaimCandidate(lockPath, order.endsWith('time')
            ? { createdAt: own.createdAt + (earlier ? -1 : 1) }
            : {
                createdAt: own.createdAt,
                token: earlier
                  ? '00000000-0000-4000-8000-000000000000'
                  : 'ffffffff-ffff-4fff-bfff-ffffffffffff',
              });
        }
        const error = new Error('gone') as NodeJS.ErrnoException;
        error.code = 'ESRCH';
        throw error;
      }
      return originalKill(pid, signal);
    }) as typeof process.kill;
    try {
      withProfilePath(profilePath, () => assert.deepEqual(learn(input()), { ok: false, error: 'lock-timeout' }));
    } finally {
      process.kill = originalKill;
    }
    assert.ok(late !== undefined && existsSync(late.path));
    if (order.startsWith('earlier')) {
      assert.deepEqual(JSON.parse(readFileSync(lockPath, 'utf8')), originalMain);
    } else {
      assert.equal(existsSync(lockPath), false);
    }
    const candidates = readdirSync(path.dirname(profilePath)).filter((name) =>
      name.startsWith(`${path.basename(lockPath)}.reclaim.`) && !name.endsWith('.main-link'),
    );
    assert.deepEqual(candidates, [path.basename(late.path)]);
  }
});

test('large reclaim-candidate directories still obey the monotonic acquisition deadline', () => {
  const profilePath = freshProfilePath();
  seed(profilePath);
  const lockPath = `${profilePath}${PROFILE_LOCK_SUFFIX}`;
  const base = Date.now();
  for (let index = 0; index < 10_000; index++) {
    reclaimCandidate(lockPath, { createdAt: base + index });
  }
  const started = performance.now();
  withProfilePath(profilePath, () => assert.deepEqual(learn(input()), { ok: false, error: 'lock-timeout' }));
  assert.ok(performance.now() - started < 1_000, 'candidate scanning must remain bounded near the 500ms contract');
});

test('two concurrent reclaimers produce one update and clean only the winning claim', async () => {
  const profilePath = freshProfilePath();
  seed(profilePath);
  foreignLock(profilePath, {
    token: 'dead-owner-two-reclaimers',
    pid: 2_147_483_647,
    createdAt: Date.now() - PROFILE_LOCK_STALE_MS - 1_000,
  });
  const payload = JSON.stringify(input());
  const run = () => spawn(process.execPath, [sourceScript, 'learn'], {
    env: { ...process.env, IM_DUMB_PROFILE: profilePath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const children = [run(), run()];
  const results = await Promise.all(children.map((child) => new Promise<{ code: number | null; stdout: string }>((resolve) => {
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.resume();
    child.on('close', (code) => resolve({ code, stdout }));
    child.stdin.end(payload);
  })));
  assert.deepEqual(results.map((result) => result.code).sort(), [0, 1]);
  assert.equal(results.filter((result) => JSON.parse(result.stdout).applied === true).length, 1);
  assert.deepEqual(readProfile(profilePath).known_gap_types, [{ type: 'term', confidence: 0.5 }]);
  assert.equal(existsSync(`${profilePath}${PROFILE_LOCK_SUFFIX}`), false);
  assert.equal(readdirSync(path.dirname(profilePath)).some((name) => name.includes('.reclaim.')), false);
});

test('backward wall-clock changes cannot extend the monotonic acquisition timeout', () => {
  const profilePath = freshProfilePath();
  seed(profilePath);
  const lockPath = foreignLock(profilePath, { token: 'wall-clock-live', pid: process.pid, createdAt: 0 });
  const originalNow = Date.now;
  let wallClock = originalNow();
  Date.now = () => (wallClock -= 10_000);
  const started = performance.now();
  try {
    withProfilePath(profilePath, () => assert.deepEqual(learn(input()), { ok: false, error: 'lock-timeout' }));
  } finally {
    Date.now = originalNow;
  }
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= PROFILE_LOCK_TIMEOUT_MS);
  assert.ok(elapsed < PROFILE_LOCK_TIMEOUT_MS + 750);
  assert.ok(existsSync(lockPath));
});

test('a non-stale dead-PID lock is not reclaimed', () => {
  const profilePath = freshProfilePath();
  seed(profilePath);
  const lockPath = foreignLock(profilePath, {
    token: 'young-dead-owner',
    pid: 2_147_483_647,
    createdAt: Date.now(),
  });
  withProfilePath(profilePath, () => assert.deepEqual(learn(input()), { ok: false, error: 'lock-timeout' }));
  assert.ok(existsSync(lockPath));
});

test('concurrent learn writers serialize: one applies and one conflicts, with no lost or duplicate update', async () => {
  const profilePath = freshProfilePath();
  seed(profilePath, { ...FULL_PROFILE, known_gap_types: [{ type: 'term', confidence: 0.5 }] });
  const payload = JSON.stringify(input({ expectedConfidence: 0.5 }));
  const run = () => spawn(process.execPath, [sourceScript, 'learn'], {
    env: { ...process.env, IM_DUMB_PROFILE: profilePath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const children = [run(), run()];
  const results = await Promise.all(children.map((child) => new Promise<{ code: number | null; stdout: string }>((resolve) => {
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.on('close', (code) => resolve({ code, stdout }));
    child.stdin.end(payload);
  })));
  assert.deepEqual(results.map((result) => result.code).sort(), [0, 1]);
  assert.equal(results.filter((result) => JSON.parse(result.stdout).applied === true).length, 1);
  assert.equal(readProfile(profilePath).known_gap_types[0]!.confidence, 0.75);
  assert.equal(existsSync(`${profilePath}${PROFILE_LOCK_SUFFIX}`), false);
  assert.deepEqual(readdirSync(path.dirname(profilePath)), ['profile.json']);
});

test('mixed save and learn writers share the lock without partial physical overlap', async () => {
  const profilePath = freshProfilePath();
  const starting = { ...FULL_PROFILE, known_gap_types: [{ type: 'term', confidence: 0.5 }] };
  seed(profilePath, starting);
  const lockPath = foreignLock(profilePath, { token: 'mixed-start-barrier', pid: process.pid, createdAt: 0 });
  const savePayload = JSON.stringify({ ...starting, tone: 'neutral' });
  const learnPayload = JSON.stringify(input({ expectedConfidence: 0.5 }));
  const launch = (command: 'save' | 'learn', payload: string) => {
    const child = spawn(process.execPath, [sourceScript, command], {
      env: { ...process.env, IM_DUMB_PROFILE: profilePath },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    child.stdin.end(payload);
    return done;
  };

  const pending = [launch('save', savePayload), launch('learn', learnPayload)];
  await new Promise((resolve) => setTimeout(resolve, 75));
  unlinkSync(lockPath);
  const results = await Promise.all(pending);
  assert.deepEqual(results.map((result) => result.code), [0, 0]);
  assert.ok(results.every((result) => result.stderr === ''));
  const final = readProfile(profilePath);
  assert.equal(final.tone, 'neutral');
  assert.ok([0.5, 0.75].includes(final.known_gap_types[0]!.confidence));
  assert.doesNotThrow(() => JSON.parse(readFileSync(profilePath, 'utf8')));
  assert.deepEqual(readdirSync(path.dirname(profilePath)), ['profile.json']);
});

test('learn CLI preserves stdout/stderr/exit contracts for success, typed conflict, malformed input, and invalid shape', () => {
  const profilePath = freshProfilePath();
  seed(profilePath);

  let result = cli(profilePath, 'learn', JSON.stringify(input()));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).applied, true);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim().split('\n').length, 1);

  result = cli(profilePath, 'learn', JSON.stringify(input()));
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { error: 'conflict', currentConfidence: 0.5 });
  assert.equal(result.stderr, 'learn: conflict\n');

  result = cli(profilePath, 'learn', '{ nope');
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).error, 'usage');
  assert.equal(result.stderr, '');

  // JSON parsed successfully; the closed LearnGapInput shape is operational
  // validation (exit 1), not a malformed-stdin usage failure (exit 2).
  result = cli(profilePath, 'learn', JSON.stringify({ ...input(), rawReply: 'do not persist' }));
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { error: 'invalid' });
  assert.equal(result.stderr, 'learn: invalid\n');

  const missingPath = freshProfilePath();
  result = cli(missingPath, 'learn', JSON.stringify(input()));
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { error: 'missing' });
  assert.equal(result.stderr, 'learn: missing\n');
});

test('save CLI maps lock-timeout to exit 1 and leaves the foreign lock', () => {
  const profilePath = freshProfilePath();
  seed(profilePath);
  const lockPath = foreignLock(profilePath, { token: 'save-cli-foreign', pid: process.pid, createdAt: 0 });
  const before = readFileSync(lockPath, 'utf8');
  const result = cli(profilePath, 'save', JSON.stringify(FULL_PROFILE));
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { error: 'lock-timeout' });
  assert.equal(result.stderr, '');
  assert.equal(readFileSync(lockPath, 'utf8'), before);
});

test('save uses the same lock and leaves private atomic output with no lock/temp leak', () => {
  const profilePath = freshProfilePath();
  withProfilePath(profilePath, () => assert.equal(save(FULL_PROFILE).ok, true));
  assert.deepEqual(readdirSync(path.dirname(profilePath)), ['profile.json']);
  assert.equal(statSync(profilePath).mode & 0o777, 0o600);
});
