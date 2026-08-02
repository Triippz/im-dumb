#!/usr/bin/env node
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runChecks } from './check-cli.ts';
import type { CheckerId, Violation } from './checkers.ts';
import { type Profile, load } from './profile.ts';

export type HarnessId = 'claude' | 'codex' | 'pi';

export const HARNESS_LOG_ROOTS: Record<HarnessId, string> = {
  claude: '.claude/projects',
  codex: '.codex/sessions',
  pi: '.pi/agent/sessions',
};

export const DEFAULT_SESSION_LIMIT = 20;

export interface AssistantTurn {
  harness: HarnessId;
  session: string;
  text: string;
}

export interface HarnessReport {
  harness: HarnessId;
  sessions: number;
  turns: number;
  turnsWithError: number;
  turnsWithWarn: number;
  byChecker: Partial<Record<CheckerId, number>>;
}

function textFromBlocks(content: unknown): string | null {
  if (typeof content === 'string') return content.trim() === '' ? null : content;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((block): block is { type: string; text: string } =>
      typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
  return text === '' ? null : text;
}

export function extractAssistantText(harness: HarnessId, entry: unknown): string | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as Record<string, unknown>;
  if (harness === 'claude') {
    if (record.type !== 'assistant') return null;
    const message = record.message as { content?: unknown } | undefined;
    return textFromBlocks(message?.content);
  }
  if (harness === 'pi') {
    if (record.type !== 'message') return null;
    const message = record.message as { role?: unknown; content?: unknown } | undefined;
    if (message?.role !== 'assistant') return null;
    return textFromBlocks(message.content);
  }
  if (record.type !== 'event_msg') return null;
  const payload = record.payload as { type?: unknown; message?: unknown } | undefined;
  if (payload?.type !== 'agent_message') return null;
  return typeof payload.message === 'string' ? textFromBlocks(payload.message) : null;
}

function findLogs(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) walk(full);
      else if (entry.endsWith('.jsonl')) found.push(full);
    }
  };
  walk(root);
  return found;
}

function newestFirst(files: string[]): string[] {
  return files
    .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map((entry) => entry.file);
}

export function collectTurns(
  harness: HarnessId,
  home: string,
  limit: number,
): { turns: AssistantTurn[]; sessions: number } {
  const files = newestFirst(findLogs(path.join(home, HARNESS_LOG_ROOTS[harness]))).slice(0, limit);
  const turns: AssistantTurn[] = [];
  for (const file of files) {
    const session = path.basename(file, '.jsonl');
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const text = extractAssistantText(harness, entry);
      if (text !== null) turns.push({ harness, session, text });
    }
  }
  return { turns, sessions: files.length };
}

export function buildReport(
  harness: HarnessId,
  turns: readonly AssistantTurn[],
  sessions: number,
  profile: Profile,
): HarnessReport {
  const byChecker: Partial<Record<CheckerId, number>> = {};
  let turnsWithError = 0;
  let turnsWithWarn = 0;
  for (const turn of turns) {
    const violations: Violation[] = runChecks(turn.text, profile, false);
    if (violations.some((violation) => violation.severity === 'error')) turnsWithError += 1;
    if (violations.some((violation) => violation.severity === 'warn')) turnsWithWarn += 1;
    for (const checker of new Set(violations.map((violation) => violation.checker))) {
      byChecker[checker] = (byChecker[checker] ?? 0) + 1;
    }
  }
  return { harness, sessions, turns: turns.length, turnsWithError, turnsWithWarn, byChecker };
}

export function formatHuman(reports: readonly HarnessReport[]): string {
  const lines: string[] = [];
  for (const report of reports) {
    if (report.sessions === 0) {
      lines.push(`${report.harness}: no session logs found`);
      continue;
    }
    const rate = report.turns === 0 ? 0 : (report.turnsWithError / report.turns) * 100;
    lines.push(
      `${report.harness}: ${report.turns} assistant turns across ${report.sessions} sessions, `
      + `${report.turnsWithError} with a profile error (${rate.toFixed(1)}%), ${report.turnsWithWarn} with a warning`,
    );
    for (const [checker, count] of Object.entries(report.byChecker).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${checker}: ${count}`);
    }
  }
  lines.push('Counts cover every assistant turn in the log, including turns where the skill never loaded.');
  return lines.join('\n');
}

export interface ParsedArgs {
  harnesses: HarnessId[];
  limit: number;
  home: string;
  json: boolean;
}

export type ParseResult = { ok: true; args: ParsedArgs } | { ok: false; message: string };

export function parseArgs(argv: readonly string[]): ParseResult {
  const args: ParsedArgs = {
    harnesses: ['claude', 'codex', 'pi'],
    limit: DEFAULT_SESSION_LIMIT,
    home: homedir(),
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    const value = argv[i + 1];
    if (token === '--json') {
      args.json = true;
      continue;
    }
    if (token === '--harness' || token === '--limit' || token === '--home') {
      if (value === undefined || value.startsWith('--')) return { ok: false, message: `${token} requires a value` };
      i += 1;
      if (token === '--home') args.home = value;
      if (token === '--limit') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) return { ok: false, message: '--limit must be a positive integer' };
        args.limit = parsed;
      }
      if (token === '--harness') {
        const requested = value.split(',').map((item) => item.trim());
        const unknown = requested.filter((item) => !(item in HARNESS_LOG_ROOTS));
        if (unknown.length > 0) return { ok: false, message: `unknown harness: ${unknown.join(', ')}` };
        args.harnesses = requested as HarnessId[];
      }
      continue;
    }
    return { ok: false, message: `unknown argument: ${token}` };
  }
  return { ok: true, args };
}

export function run(argv: readonly string[], log: (line: string) => void = console.log): number {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    log(parsed.message);
    log('usage: im-dumb-session-report [--harness claude,codex,pi] [--limit 20] [--json]');
    return 2;
  }
  const outcome = load();
  if (!outcome.ok) {
    log(`no usable profile (${outcome.error}); ask your agent to "set up im-dumb" first`);
    return 1;
  }
  const reports = parsed.args.harnesses.map((harness) => {
    const { turns, sessions } = collectTurns(harness, parsed.args.home, parsed.args.limit);
    return buildReport(harness, turns, sessions, outcome.profile);
  });
  log(parsed.args.json ? JSON.stringify({ reports }, null, 2) : formatHuman(reports));
  return 0;
}

function isDirectExecution(argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

if (isDirectExecution(process.argv[1])) {
  process.exitCode = run(process.argv.slice(2));
}
