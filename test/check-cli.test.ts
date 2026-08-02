import assert from 'node:assert/strict';
import { test, describe, before } from 'node:test';
import { spawnSync, execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs, runChecks, formatJson, formatHuman } from '../src/check-cli.ts';
import { DEFAULT_PROFILE, type Profile } from '../src/profile.ts';
import type { Violation } from '../src/checkers.ts';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const cliScript = path.join(repoRoot, 'src', 'check-cli.ts');
const distCliScript = path.join(repoRoot, 'dist', 'check-cli.js');
let isolatedDistCliScript = '';

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'im-dumb-check-cli-'));
}

function writeTemp(dir: string, name: string, contents: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, contents, 'utf8');
  return file;
}

function runCli(scriptPath: string, args: string[], opts: { input?: string; cwd?: string } = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: opts.cwd ?? repoRoot,
    input: opts.input,
    encoding: 'utf8',
  });
}

const CLEAN_TEXT = 'Restart the service. It picks up the new config right away.';
const FORBIDDEN_TEXT = 'Just restart the service and it will pick up the new config.';

// ---------------------------------------------------------------------------
// parseArgs, minimal CLI contract
// ---------------------------------------------------------------------------

test('parseArgs: no arguments parses to defaults', () => {
  const result = parseArgs([]);
  assert.deepEqual(result, { ok: true, args: { skillDoc: false, json: false } });
});

test('parseArgs: recognizes --file, --profile, --skill-doc, --json together', () => {
  const result = parseArgs(['--file', 'a.txt', '--profile', 'p.json', '--skill-doc', '--json']);
  assert.deepEqual(result, {
    ok: true,
    args: { file: 'a.txt', profile: 'p.json', skillDoc: true, json: true },
  });
});

test('parseArgs: --file with no following value is a parse error', () => {
  const result = parseArgs(['--file']);
  assert.equal(result.ok, false);
});

test('parseArgs: --profile with no following value is a parse error', () => {
  const result = parseArgs(['--profile']);
  assert.equal(result.ok, false);
});

test('parseArgs: unrecognized flag is a parse error', () => {
  const result = parseArgs(['--bogus']);
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// runChecks dispatch, severity downgrade in --skill-doc mode
// ---------------------------------------------------------------------------

test('runChecks: default mode dispatches language checkers as errors, never runs frontmatter', () => {
  const profile: Profile = { ...DEFAULT_PROFILE, output_shape: 'narrative' };
  const violations = runChecks(FORBIDDEN_TEXT, profile, false);
  assert.ok(violations.some((v) => v.checker === 'forbidden-phrases' && v.severity === 'error'));
  assert.ok(!violations.some((v) => v.checker === 'frontmatter'));
});

test('runChecks: --skill-doc mode downgrades a language error to warn', () => {
  const profile: Profile = { ...DEFAULT_PROFILE, output_shape: 'narrative' };
  const content = `---\nname: im-dumb\ndescription: Shapes responses to a user profile.\nmetadata:\n  version: 0.1.0\n---\n${FORBIDDEN_TEXT}\n`;
  const violations = runChecks(content, profile, true);
  const forbidden = violations.find((v) => v.checker === 'forbidden-phrases');
  assert.ok(forbidden, 'expected a forbidden-phrases violation');
  assert.equal(forbidden!.severity, 'warn');
});

test('runChecks: --skill-doc mode keeps structural frontmatter errors blocking even with a clean body', () => {
  const profile: Profile = { ...DEFAULT_PROFILE, output_shape: 'narrative' };
  const content = `---\ndescription: Shapes responses to a user profile.\nmetadata:\n  version: 0.1.0\n---\n${CLEAN_TEXT}\n`;
  const violations = runChecks(content, profile, true);
  assert.ok(violations.some((v) => v.checker === 'frontmatter' && v.severity === 'error'));
});

// ---------------------------------------------------------------------------
// Output formatting, deterministic JSON and human modes
// ---------------------------------------------------------------------------

test('formatJson: no violations', () => {
  assert.equal(formatJson([]), '{"violations":[],"errorCount":0,"warnCount":0}\n');
});

test('formatJson: mixed error/warn violations counted correctly', () => {
  const violations: Violation[] = [
    { checker: 'forbidden-phrases', severity: 'error', message: 'forbidden phrase found: "just"' },
    { checker: 'adhd-structure', severity: 'warn', message: 'list has 4 sibling items, expected at most 3' },
  ];
  const parsed = JSON.parse(formatJson(violations));
  assert.deepEqual(parsed, { violations, errorCount: 1, warnCount: 1 });
});

test('formatHuman: no violations', () => {
  assert.equal(formatHuman([]), 'no violations\n');
});

test('formatHuman: renders one line per violation plus a summary line', () => {
  const violations: Violation[] = [
    { checker: 'forbidden-phrases', severity: 'error', message: 'forbidden phrase found: "just"' },
    { checker: 'adhd-structure', severity: 'warn', message: 'list has 4 sibling items, expected at most 3' },
  ];
  assert.equal(
    formatHuman(violations),
    'error: [forbidden-phrases] forbidden phrase found: "just"\n' +
      'warn: [adhd-structure] list has 4 sibling items, expected at most 3\n' +
      '1 error(s), 1 warning(s)\n',
  );
});

// ---------------------------------------------------------------------------
// Subprocess: stdin / file input, exit codes, JSON machine-safety
// ---------------------------------------------------------------------------

test('CLI: clean text via stdin, default profile, --json exits 0 with empty violations', () => {
  const result = runCli(cliScript, ['--json'], { input: CLEAN_TEXT });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { violations: [], errorCount: 0, warnCount: 0 });
});

test('CLI: JSON mode stdout is machine-safe -- exactly one line, nothing else', () => {
  const result = runCli(cliScript, ['--json'], { input: CLEAN_TEXT });
  assert.equal(result.stdout.trim().split('\n').length, 1);
});

test('CLI: forbidden phrase via stdin exits 1, human mode reports the violation', () => {
  const result = runCli(cliScript, [], { input: FORBIDDEN_TEXT });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /error: \[forbidden-phrases\]/);
  assert.match(result.stdout, /1 error\(s\)/);
});

test('CLI: --file reads text from a file instead of stdin', () => {
  const dir = freshDir();
  const file = writeTemp(dir, 'input.txt', FORBIDDEN_TEXT);
  const result = runCli(cliScript, ['--file', file, '--json']);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.violations.some((v: Violation) => v.checker === 'forbidden-phrases'));
});

test('CLI: --profile applies a custom profile from a file', () => {
  const dir = freshDir();
  const profile = { ...DEFAULT_PROFILE, output_shape: 'narrative', forbidden_phrases: ['gizmo'] };
  const profileFile = writeTemp(dir, 'profile.json', JSON.stringify(profile));
  const result = runCli(cliScript, ['--profile', profileFile, '--json'], { input: 'Plug in the gizmo and go.' });
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.violations.some((v: Violation) => v.message.includes('gizmo')));
});

test('CLI: warn-only violations (ADHD structure) exit 0', () => {
  const dir = freshDir();
  const profile = { ...DEFAULT_PROFILE, adhd_mode: true, output_shape: 'narrative' };
  const profileFile = writeTemp(dir, 'profile.json', JSON.stringify(profile));
  const text = ['Direct answer up front here.', '', '## Details', '- one', '- two', '- three', '- four'].join('\n');
  const result = runCli(cliScript, ['--profile', profileFile, '--json'], { input: text });
  assert.equal(result.status, 0, `expected exit 0 for warn-only, got stdout: ${result.stdout} stderr: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.errorCount, 0);
  assert.ok(parsed.warnCount > 0);
  assert.ok(parsed.violations.every((v: Violation) => v.severity === 'warn'));
});

test('CLI: --skill-doc downgrades a language error to warn and exits 0 on an otherwise-valid doc', () => {
  const dir = freshDir();
  const profile = { ...DEFAULT_PROFILE, output_shape: 'narrative' };
  const profileFile = writeTemp(dir, 'profile.json', JSON.stringify(profile));
  const content = `---\nname: im-dumb\ndescription: Shapes responses to a user profile.\nmetadata:\n  version: 0.1.0\n---\n${FORBIDDEN_TEXT}\n`;
  const docFile = writeTemp(dir, 'SKILL.md', content);
  const result = runCli(cliScript, ['--file', docFile, '--profile', profileFile, '--skill-doc', '--json']);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.errorCount, 0);
  assert.ok(parsed.violations.some((v: Violation) => v.checker === 'forbidden-phrases' && v.severity === 'warn'));
});

test('CLI: --skill-doc still exits 1 on a structural frontmatter error', () => {
  const dir = freshDir();
  const content = `---\ndescription: Shapes responses to a user profile.\nmetadata:\n  version: 0.1.0\n---\n${CLEAN_TEXT}\n`;
  const docFile = writeTemp(dir, 'SKILL.md', content);
  const result = runCli(cliScript, ['--file', docFile, '--skill-doc', '--json']);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.violations.some((v: Violation) => v.checker === 'frontmatter' && v.severity === 'error'));
});

// ---------------------------------------------------------------------------
// Subprocess: bad invocation -> exit 2, stdout empty
// ---------------------------------------------------------------------------

test('CLI: unrecognized flag is a bad invocation (exit 2), stdout empty', () => {
  const result = runCli(cliScript, ['--bogus'], { input: CLEAN_TEXT });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /usage error/);
});

test('CLI: --file missing value is a bad invocation (exit 2)', () => {
  const result = runCli(cliScript, ['--file'], { input: CLEAN_TEXT });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
});

test('CLI: --file pointing at a nonexistent path is a bad invocation (exit 2)', () => {
  const dir = freshDir();
  const result = runCli(cliScript, ['--file', path.join(dir, 'missing.txt')]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
});

test('CLI: --profile pointing at a nonexistent path is a bad invocation (exit 2)', () => {
  const dir = freshDir();
  const result = runCli(cliScript, ['--profile', path.join(dir, 'missing.json')], { input: CLEAN_TEXT });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
});

test('CLI: --profile with malformed JSON is a bad invocation (exit 2)', () => {
  const dir = freshDir();
  const profileFile = writeTemp(dir, 'profile.json', '{ not json');
  const result = runCli(cliScript, ['--profile', profileFile], { input: CLEAN_TEXT });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
});

test('CLI: --profile with an unsupported future schema_version is a bad invocation (exit 2)', () => {
  const dir = freshDir();
  const profileFile = writeTemp(dir, 'profile.json', JSON.stringify({ ...DEFAULT_PROFILE, schema_version: 2 }));
  const result = runCli(cliScript, ['--profile', profileFile], { input: CLEAN_TEXT });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
});

// ---------------------------------------------------------------------------
// Direct execution of the compiled dist/check-cli.js, from a directory with
// no node_modules -- the dependency-free smoke test.
// ---------------------------------------------------------------------------

describe('compiled dist/check-cli.js execution', () => {
  before(() => {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe' });
    const sandbox = freshDir();
    cpSync(path.join(repoRoot, 'dist'), path.join(sandbox, 'dist'), { recursive: true });
    writeFileSync(path.join(sandbox, 'package.json'), '{"type":"module"}\n', 'utf8');
    assert.equal(existsSync(path.join(sandbox, 'node_modules')), false);
    isolatedDistCliScript = path.join(sandbox, 'dist', 'check-cli.js');
  });

  test('the isolated sandbox contains the copied dist/check-cli.js and no node_modules', () => {
    assert.ok(existsSync(distCliScript));
    assert.ok(existsSync(isolatedDistCliScript));
    assert.equal(existsSync(path.join(path.dirname(path.dirname(isolatedDistCliScript)), 'node_modules')), false);
  });

  test('runs from a fresh directory with no node_modules, clean text via stdin exits 0', () => {
    const dir = freshDir();
    assert.ok(!existsSync(path.join(dir, 'node_modules')));
    const result = runCli(isolatedDistCliScript, ['--json'], { input: CLEAN_TEXT, cwd: dir });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout), { violations: [], errorCount: 0, warnCount: 0 });
  });

  test('runs from a fresh directory with no node_modules, forbidden phrase via stdin exits 1', () => {
    const dir = freshDir();
    const result = runCli(isolatedDistCliScript, ['--json'], { input: FORBIDDEN_TEXT, cwd: dir });
    assert.equal(result.status, 1, `stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.violations.some((v: Violation) => v.checker === 'forbidden-phrases'));
  });

  test('runs --file from a fresh directory with no node_modules', () => {
    const dir = freshDir();
    const file = writeTemp(dir, 'input.txt', CLEAN_TEXT);
    const result = runCli(isolatedDistCliScript, ['--file', file, '--json'], { cwd: dir });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  });

  // Step 10, Layer 1 SKILL.md structural check, run against the
  // real, committed skill/im-dumb/SKILL.md via the compiled CLI, from a
  // directory with no node_modules (dependency-free + Layer 1 in one test).
  test('runs --file --skill-doc against the real, committed SKILL.md from a directory with no node_modules, zero blocking errors', () => {
    const dir = freshDir();
    const skillMdPath = path.join(repoRoot, 'skill', 'im-dumb', 'SKILL.md');
    const result = runCli(isolatedDistCliScript, ['--file', skillMdPath, '--skill-doc', '--json'], { cwd: dir });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.errorCount, 0);
  });
});
