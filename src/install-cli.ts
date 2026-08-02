#!/usr/bin/env node
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import {
  detectHarnesses,
  parseTargets,
  resolveInstallDestinations,
  type HarnessId,
  type InstallScope,
} from './harness-detect.ts';
import { installSkill, resolveSkillPackageDir } from './install.ts';
import { load as loadProfile } from './profile.ts';

export interface InstallCliArgs {
  command: 'install' | 'help';
  targets: HarnessId[] | null;
  scope: InstallScope;
  preferAgents: boolean;
  json: boolean;
  homeDir: string;
  projectRoot: string;
  interactive: boolean;
}

export function findProjectRoot(startDir: string): string {
  let current = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

export function parseInstallCliArgs(
  argv: string[],
  defaults: { homeDir?: string; cwd?: string; isTTY?: boolean } = {},
): InstallCliArgs {
  let homeDir = defaults.homeDir ?? os.homedir();
  const cwd = defaults.cwd ?? process.cwd();
  const projectRoot = findProjectRoot(cwd);
  const isTTY = defaults.isTTY ?? Boolean(process.stdin.isTTY);

  let command: InstallCliArgs['command'] = 'install';
  let targets: HarnessId[] | null = null;
  let scope: InstallScope = 'global';
  let preferAgents = false;
  let json = false;

  const args = [...argv];
  if (args[0] === 'install' || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    const head = args.shift()!;
    command = head === 'install' ? 'install' : 'help';
  }
  if (args.includes('--help') || args.includes('-h')) {
    command = 'help';
    // drop help flags so the option loop does not treat them as unknown
    for (let i = args.length - 1; i >= 0; i -= 1) {
      if (args[i] === '--help' || args[i] === '-h') args.splice(i, 1);
    }
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--prefer-agents') {
      preferAgents = true;
      continue;
    }
    if (arg === '--scope') {
      const value = args[++i];
      if (value !== 'global' && value !== 'project') {
        throw new Error('--scope must be global or project');
      }
      scope = value;
      continue;
    }
    if (arg === '--targets') {
      const value = args[++i];
      if (!value) throw new Error('--targets requires a value');
      targets = parseTargets(value);
      continue;
    }
    if (arg === '--home') {
      const value = args[++i];
      if (!value) throw new Error('--home requires a value');
      homeDir = value;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return {
    command,
    targets,
    scope,
    preferAgents,
    json,
    homeDir,
    projectRoot,
    interactive: targets === null && isTTY && command === 'install',
  };
}

export function usage(): string {
  return [
    'Usage:',
    '  im-dumb install [--targets claude,cursor,codex,pi] [--scope global|project] [--prefer-agents] [--json]',
    '  im-dumb install   # interactive when TTY',
    '  --home <path>       # test a different home directory',
    '',
    'Codex installs into .codex/skills for local Codex sessions.',
    'Hosted Claude API / OpenAI uploads are out of scope for v1.',
  ].join('\n');
}

export async function runInstallCli(
  args: InstallCliArgs,
  io: {
    ask?: (prompt: string) => Promise<string>;
    log?: (line: string) => void;
  } = {},
): Promise<{ exitCode: number; results: unknown }> {
  const log = io.log ?? ((line: string) => console.log(line));
  if (args.command === 'help') {
    log(usage());
    return { exitCode: 0, results: null };
  }

  const detected = detectHarnesses({
    homeDir: args.homeDir,
    projectRoot: args.projectRoot,
    codexHome: process.env.CODEX_HOME,
  });
  let targets = args.targets;
  let scope = args.scope;

  if (targets === null) {
    if (!args.interactive) {
      return {
        exitCode: 2,
        results: {
          error: 'non-interactive install requires --targets (or a TTY for prompts)',
          detected: detected.map((item) => item.id),
        },
      };
    }
    const selected = await promptTargets(detected, io.ask, log);
    targets = selected.targets;
    scope = selected.scope;
  }

  const destinations = resolveInstallDestinations({
    targets,
    scope,
    homeDir: args.homeDir,
    projectRoot: args.projectRoot,
    preferAgents: args.preferAgents,
    codexHome: process.env.CODEX_HOME,
  });

  const sourceDir = resolveSkillPackageDir();
  const installed = new Map<string, ReturnType<typeof installSkill>>();
  const results = [];
  for (const dest of destinations) {
    const prior = installed.get(dest.destDir);
    if (prior) {
      results.push({ ...dest, action: 'skipped', version: prior.version, reason: 'shared destination already handled' });
      continue;
    }
    const outcome = installSkill({ sourceDir, destDir: dest.destDir });
    installed.set(dest.destDir, outcome);
    results.push({ ...dest, ...outcome });
  }

  if (args.json) {
    log(JSON.stringify({ scope, results }, null, 2));
  } else {
    for (const item of results) {
      const row = item as {
        harness: string;
        action: string;
        destDir: string;
        version?: string;
        reason?: string;
      };
      log(
        `${row.harness}: ${row.action} → ${row.destDir}` +
          (row.version ? ` (v${row.version})` : '') +
          (row.reason ? ` [${row.reason}]` : ''),
      );
    }
    if (!loadProfile().ok) {
      log('no profile yet, so answers stay unchanged: ask your agent to "set up im-dumb"');
    }
  }

  return { exitCode: 0, results };
}

async function promptTargets(
  detected: ReturnType<typeof detectHarnesses>,
  askFn: ((prompt: string) => Promise<string>) | undefined,
  log: (line: string) => void,
): Promise<{ targets: HarnessId[]; scope: InstallScope }> {
  const ask =
    askFn ??
    (async (prompt: string) => {
      const rl = createInterface({ input, output });
      try {
        return (await rl.question(prompt)).trim();
      } finally {
        rl.close();
      }
    });

  if (!detected.length) {
    throw new Error('no harnesses detected (looked for .claude, .cursor, .codex, .pi, .agents)');
  }
  log(`Detected: ${detected.map(({ id }) => id).join(', ')}`);

  const defaultIds = detected.map(({ id }) => id).join(',');
  const rawTargets = await ask(`Targets [${defaultIds}]: `);
  const targets = parseTargets(rawTargets === '' ? defaultIds : rawTargets);
  const rawScope = await ask('Scope [global]: ');
  const scope: InstallScope = rawScope === 'project' ? 'project' : 'global';
  return { targets, scope };
}

async function main(): Promise<void> {
  try {
    const args = parseInstallCliArgs(process.argv.slice(2));
    const { exitCode } = await runInstallCli(args);
    process.exitCode = exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(usage());
    process.exitCode = 2;
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
const self = path.resolve(fileURLToPath(import.meta.url));
if (entry === self || entry.endsWith(`${path.sep}install-cli.ts`) || entry.endsWith(`${path.sep}install-cli.js`)) {
  void main();
}
