import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  parseInstallCliArgs,
  runInstallCli,
  usage,
} from '../src/install-cli.ts';

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'im-dumb-cli-'));
}

test('parseInstallCliArgs: defaults to install + global scope', () => {
  const args = parseInstallCliArgs(['--targets', 'claude'], {
    homeDir: '/tmp/home',
    cwd: '/tmp/proj',
    isTTY: false,
  });
  assert.equal(args.command, 'install');
  assert.deepEqual(args.targets, ['claude']);
  assert.equal(args.scope, 'global');
  assert.equal(args.interactive, false);
});

test('parseInstallCliArgs: rejects unknown flags', () => {
  assert.throws(() => parseInstallCliArgs(['--nope']), /unknown argument/);
});

test('usage mentions non-interactive contract', () => {
  assert.match(usage(), /--targets claude,cursor,codex,pi/);
  assert.match(usage(), /Codex/);
});

test('runInstallCli: non-interactive installs into temp home', async () => {
  const home = tempDir();
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  const args = parseInstallCliArgs(
    ['install', '--targets', 'claude', '--scope', 'global', '--json', '--home', home],
    { homeDir: home, cwd: home, isTTY: false },
  );
  const lines: string[] = [];
  const { exitCode, results } = await runInstallCli(args, {
    log: (line) => lines.push(line),
  });
  assert.equal(exitCode, 0);
  const dest = path.join(home, '.claude', 'skills', 'im-dumb', 'SKILL.md');
  assert.match(readFileSync(dest, 'utf8'), /name: im-dumb/);
  assert.ok(Array.isArray(results));
  assert.ok(lines.some((line) => line.includes('"action"')));
});

test('runInstallCli: installs Codex into its native root', async () => {
  const home = tempDir();
  const args = parseInstallCliArgs(
    ['install', '--targets', 'codex', '--scope', 'global', '--home', home],
    { homeDir: home, cwd: home, isTTY: false },
  );
  const { exitCode } = await runInstallCli(args, { log: () => {} });
  assert.equal(exitCode, 0);
  assert.match(readFileSync(path.join(home, '.codex', 'skills', 'im-dumb', 'SKILL.md'), 'utf8'), /name: im-dumb/);
});

test('runInstallCli: missing --targets without TTY fails closed', async () => {
  const home = tempDir();
  const args = parseInstallCliArgs([], { homeDir: home, cwd: home, isTTY: false });
  const { exitCode } = await runInstallCli(args);
  assert.equal(exitCode, 2);
});

test('runInstallCli: interactive path uses ask() and defaults', async () => {
  const home = tempDir();
  mkdirSync(path.join(home, '.cursor'), { recursive: true });
  const args = parseInstallCliArgs([], { homeDir: home, cwd: home, isTTY: true });
  assert.equal(args.interactive, true);
  const prompts: string[] = [];
  const { exitCode } = await runInstallCli(args, {
    ask: async (prompt) => {
      prompts.push(prompt);
      if (prompt.startsWith('Targets')) return 'cursor';
      return 'global';
    },
    log: () => {},
  });
  assert.equal(exitCode, 0);
  assert.ok(prompts.length >= 2);
  assert.ok(
    readFileSync(path.join(home, '.cursor', 'skills', 'im-dumb', 'SKILL.md'), 'utf8').includes(
      'im-dumb',
    ),
  );
});
