import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  HARNESS_LOG_ROOTS,
  buildReport,
  collectTurns,
  extractAssistantText,
  formatHuman,
  parseArgs,
  run,
} from '../src/session-report.ts';
import { DEFAULT_PROFILE } from '../src/profile.ts';

const LONG_SENTENCE = `${Array.from({ length: 40 }, (_, index) => `word${index}`).join(' ')}.`;

function fakeHome(): string {
  return mkdtempSync(path.join(tmpdir(), 'im-dumb-report-'));
}

function writeLog(home: string, harness: keyof typeof HARNESS_LOG_ROOTS, name: string, lines: unknown[]) {
  const dir = path.join(home, HARNESS_LOG_ROOTS[harness], 'project');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), lines.map((line) => JSON.stringify(line)).join('\n'));
}

test('each harness log shape yields assistant text and nothing else', () => {
  assert.equal(
    extractAssistantText('claude', { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
    'hi',
  );
  assert.equal(extractAssistantText('claude', { type: 'user', message: { content: 'hi' } }), null);

  assert.equal(
    extractAssistantText('pi', { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }),
    'hi',
  );
  assert.equal(
    extractAssistantText('pi', { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
    null,
  );

  assert.equal(extractAssistantText('codex', { type: 'event_msg', payload: { type: 'agent_message', message: 'hi' } }), 'hi');
  assert.equal(extractAssistantText('codex', { type: 'event_msg', payload: { type: 'user_message', message: 'hi' } }), null);

  assert.equal(extractAssistantText('claude', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x' }] } }), null);
});

test('collectTurns walks nested directories and skips malformed lines', () => {
  const home = fakeHome();
  writeLog(home, 'claude', 'a.jsonl', [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } },
    { type: 'user', message: { content: 'ignored' } },
  ]);
  const dir = path.join(home, HARNESS_LOG_ROOTS.claude, 'project');
  writeFileSync(path.join(dir, 'b.jsonl'), '{ not json\n{"type":"assistant","message":{"content":[{"type":"text","text":"second"}]}}');

  const { turns, sessions } = collectTurns('claude', home, 20);
  assert.equal(sessions, 2);
  assert.deepEqual(turns.map((turn) => turn.text).sort(), ['first', 'second']);
});

test('collectTurns honours the session limit', () => {
  const home = fakeHome();
  for (const name of ['a.jsonl', 'b.jsonl', 'c.jsonl']) {
    writeLog(home, 'pi', name, [{ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] } }]);
  }
  assert.equal(collectTurns('pi', home, 2).sessions, 2);
});

test('buildReport counts a turn once per checker and reports the error rate', () => {
  const profile = { ...DEFAULT_PROFILE, forbidden_phrases: ['obviously'] };
  const turns = [
    { harness: 'claude' as const, session: 's', text: 'Short answer.' },
    { harness: 'claude' as const, session: 's', text: `obviously obviously ${LONG_SENTENCE}` },
  ];
  const report = buildReport('claude', turns, 1, profile);
  assert.equal(report.turns, 2);
  assert.equal(report.byChecker['forbidden-phrases'], 1);
  assert.ok(report.turnsWithError >= 1);
  assert.match(formatHuman([report]), /claude: 2 assistant turns across 1 sessions/);
});

test('formatHuman names harnesses with no logs instead of showing a zero rate', () => {
  const output = formatHuman([{ harness: 'codex', sessions: 0, turns: 0, turnsWithError: 0, turnsWithWarn: 0, byChecker: {} }]);
  assert.match(output, /codex: no session logs found/);
});

test('parseArgs rejects unknown harnesses, bad limits, and missing values', () => {
  const scoped = parseArgs(['--harness', 'pi']);
  assert.ok(scoped.ok);
  assert.deepEqual(scoped.args.harnesses, ['pi']);
  assert.equal(parseArgs(['--harness', 'cursor']).ok, false);
  assert.equal(parseArgs(['--limit', '0']).ok, false);
  assert.equal(parseArgs(['--limit']).ok, false);
  assert.equal(parseArgs(['--nope']).ok, false);
});

test('run exits non-zero and says what to do when no profile exists', () => {
  const home = fakeHome();
  const lines: string[] = [];
  const previous = process.env.IM_DUMB_PROFILE;
  process.env.IM_DUMB_PROFILE = path.join(home, 'absent.json');
  try {
    assert.equal(run(['--home', home], (line) => lines.push(line)), 1);
  } finally {
    if (previous === undefined) delete process.env.IM_DUMB_PROFILE;
    else process.env.IM_DUMB_PROFILE = previous;
  }
  assert.ok(lines.some((line) => /set up im-dumb/.test(line)));
});

test('run reports every harness as JSON when a profile exists', () => {
  const home = fakeHome();
  writeLog(home, 'codex', 'a.jsonl', [{ type: 'event_msg', payload: { type: 'agent_message', message: 'Short answer.' } }]);
  const profilePath = path.join(home, 'profile.json');
  writeFileSync(profilePath, JSON.stringify(DEFAULT_PROFILE));

  const lines: string[] = [];
  const previous = process.env.IM_DUMB_PROFILE;
  process.env.IM_DUMB_PROFILE = profilePath;
  try {
    assert.equal(run(['--home', home, '--json'], (line) => lines.push(line)), 0);
  } finally {
    if (previous === undefined) delete process.env.IM_DUMB_PROFILE;
    else process.env.IM_DUMB_PROFILE = previous;
  }
  const parsed = JSON.parse(lines.join('\n')) as { reports: { harness: string; turns: number }[] };
  assert.deepEqual(parsed.reports.map((report) => report.harness), ['claude', 'codex', 'pi']);
  assert.equal(parsed.reports.find((report) => report.harness === 'codex')?.turns, 1);
});
