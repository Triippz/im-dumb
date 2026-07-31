import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const scriptsDir = path.join(repoRoot, 'skill', 'im-dumb', 'scripts');
const profileScript = path.join(scriptsDir, 'profile.js');

const FULL_PROFILE = {
  schema_version: 1,
  vocabulary_level: 'technical-ok',
  jargon_policy: 'avoid',
  sentence_length_cap: 25,
  paragraph_topic_limit: 2,
  tone: 'friendly',
  output_shape: 'narrative',
  adhd_mode: true,
  known_gap_types: [{ type: 'recursion', confidence: 0.42 }],
  forbidden_phrases: ['synergy'],
  learning_asset_preferences: { formats: ['markdown'] },
};

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'im-dumb-profile-bundle-'));
}

function runBundle(cwd: string, args: string[], env: Record<string, string | undefined>, input?: string) {
  const childEnv = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  assert.equal(existsSync(path.join(cwd, 'node_modules')), false);
  const installedScript = path.join(cwd, 'profile.js');
  copyFileSync(profileScript, installedScript);
  return spawnSync(process.execPath, [installedScript, ...args], {
    cwd,
    env: childEnv,
    input,
    encoding: 'utf8',
  });
}

test('the committed skill scripts directory contains only the dependency-free profile bundle', () => {
  assert.deepEqual(readdirSync(scriptsDir).sort(), ['profile.js']);

  const source = readFileSync(profileScript, 'utf8');
  const imports = [...new Set([...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)].map((match) => match[1]))].sort();
  assert.deepEqual(imports, ['node:crypto', 'node:fs', 'node:os', 'node:path', 'node:url']);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u);
  assert.doesNotMatch(source, /\b(?:require|import)\s*\(/u);
});

test('the committed bundle runs with bare Node from a directory without node_modules and preserves load stream/exit contracts', () => {
  const cwd = freshDir();
  const home = freshDir();

  let result = runBundle(cwd, ['load'], { HOME: home, IM_DUMB_PROFILE: undefined });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { error: 'missing' });
  assert.equal(result.stderr, '');

  result = runBundle(cwd, [], { HOME: home, IM_DUMB_PROFILE: undefined });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^usage: profile\.js <load\|validate\|save\|learn>\n$/u);

  const profileDir = path.join(home, '.im-dumb');
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(path.join(profileDir, 'profile.json'), JSON.stringify({ schema_version: 1 }), 'utf8');
  result = runBundle(cwd, ['load'], { HOME: home, IM_DUMB_PROFILE: undefined });
  assert.equal(result.status, 0);
  const loaded = JSON.parse(result.stdout);
  assert.equal(loaded.profile.schema_version, 1);
  assert.ok(loaded.warnings.some((warning: string) => warning.includes('tone')));
  assert.equal(result.stdout.trim().split('\n').length, 1, 'stdout must contain one JSON value');
  assert.match(result.stderr, /^warning: /u);
});

test('the committed bundle honors IM_DUMB_PROFILE and saves atomically with private permissions', () => {
  const cwd = freshDir();
  const home = freshDir();
  const customDir = path.join(home, 'private-profile');
  const customPath = path.join(customDir, 'custom.json');
  const env = { HOME: home, IM_DUMB_PROFILE: customPath };

  const saveResult = runBundle(cwd, ['save'], env, JSON.stringify(FULL_PROFILE));
  assert.equal(saveResult.status, 0, saveResult.stderr);
  assert.deepEqual(JSON.parse(saveResult.stdout).profile, FULL_PROFILE);
  assert.equal(saveResult.stderr, '');
  assert.equal(existsSync(path.join(home, '.im-dumb', 'profile.json')), false);
  assert.deepEqual(readdirSync(customDir), ['custom.json'], 'atomic save must leave no temporary file');
  assert.equal(statSync(customDir).mode & 0o777, 0o700);
  assert.equal(statSync(customPath).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(customPath, 'utf8')), FULL_PROFILE);

  const loadResult = runBundle(cwd, ['load'], env);
  assert.equal(loadResult.status, 0);
  assert.deepEqual(JSON.parse(loadResult.stdout), { profile: FULL_PROFILE, warnings: [] });
  assert.equal(loadResult.stderr, '');
});

test('the committed bundle applies strict CAS learn offline with no extra dependency', () => {
  const cwd = freshDir();
  const home = freshDir();
  const profilePath = path.join(home, 'profile.json');
  const env = { HOME: home, IM_DUMB_PROFILE: profilePath };
  writeFileSync(profilePath, JSON.stringify(FULL_PROFILE), { encoding: 'utf8', mode: 0o600 });

  let result = runBundle(cwd, ['learn'], env, JSON.stringify({
    type: 'term', outcome: 'success', expectedConfidence: null,
  }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).applied, true);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(readFileSync(profilePath, 'utf8')).known_gap_types, [
    ...FULL_PROFILE.known_gap_types,
    { type: 'term', confidence: 0.5 },
  ]);

  result = runBundle(cwd, ['learn'], env, JSON.stringify({
    type: 'term', outcome: 'success', expectedConfidence: null,
  }));
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { error: 'conflict', currentConfidence: 0.5 });
  assert.equal(result.stderr, 'learn: conflict\n');
  assert.deepEqual(readdirSync(home), ['profile.json']);
});

test('the committed bundle validates without mutation and preserves hidden fields through load-modify-save', () => {
  const cwd = freshDir();
  const home = freshDir();
  const profilePath = path.join(home, 'profile.json');
  const env = { HOME: home, IM_DUMB_PROFILE: profilePath };
  const invalid = JSON.stringify({ ...FULL_PROFILE, unexpected: true });
  writeFileSync(profilePath, invalid, 'utf8');

  const validateResult = runBundle(cwd, ['validate'], env);
  assert.equal(validateResult.status, 1);
  const validation = JSON.parse(validateResult.stdout);
  assert.equal(validation.valid, false);
  assert.equal(validation.error, 'invalid');
  assert.ok(validation.reasons.some((reason: string) => reason.includes('unexpected')));
  assert.equal(validateResult.stderr, '');
  assert.equal(readFileSync(profilePath, 'utf8'), invalid);

  writeFileSync(profilePath, JSON.stringify(FULL_PROFILE), 'utf8');
  const loadResult = runBundle(cwd, ['load'], env);
  assert.equal(loadResult.status, 0);
  const edited = { ...JSON.parse(loadResult.stdout).profile, tone: 'neutral' };
  const saveResult = runBundle(cwd, ['save'], env, JSON.stringify(edited));
  assert.equal(saveResult.status, 0);

  const saved = JSON.parse(readFileSync(profilePath, 'utf8'));
  assert.equal(saved.tone, 'neutral');
  assert.equal(saved.schema_version, FULL_PROFILE.schema_version);
  assert.deepEqual(saved.known_gap_types, FULL_PROFILE.known_gap_types);
  assert.deepEqual(readdirSync(home), ['profile.json'], 'replacement must leave no temporary file');
});
