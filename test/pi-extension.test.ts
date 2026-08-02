import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import imDumbExtension, { formatProfileReminder } from '../src/pi-extension.ts';
import { DEFAULT_PROFILE } from '../src/profile.ts';

function harness() {
  const handlers = new Map<string, (event: { systemPrompt: string }) => unknown>();
  imDumbExtension({ on: (event, handler) => handlers.set(event, handler) });
  return handlers;
}

function withProfile(value: unknown, run: () => void) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'im-dumb-pi-')), 'profile.json');
  if (typeof value === 'string') writeFileSync(file, value);
  else if (value !== undefined) writeFileSync(file, JSON.stringify(value));
  const previous = process.env.IM_DUMB_PROFILE;
  process.env.IM_DUMB_PROFILE = file;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.IM_DUMB_PROFILE;
    else process.env.IM_DUMB_PROFILE = previous;
  }
}

test('extension appends the active profile to the system prompt on every turn', () => {
  const handler = harness().get('before_agent_start');
  assert.ok(handler);
  withProfile({ ...DEFAULT_PROFILE, sentence_length_cap: 12, adhd_mode: true }, () => {
    const result = handler({ systemPrompt: 'base' }) as { systemPrompt: string };
    assert.match(result.systemPrompt, /^base\n\nim-dumb profile active/u);
    assert.match(result.systemPrompt, /at most 12 words/u);
    assert.match(result.systemPrompt, /ADHD mode/u);
  });
});

test('a missing or unreadable profile never blocks the turn', () => {
  const handler = harness().get('before_agent_start');
  assert.ok(handler);
  withProfile(undefined, () => {
    assert.equal(handler({ systemPrompt: 'base' }), undefined);
  });
  withProfile('{ not json', () => {
    assert.equal(handler({ systemPrompt: 'base' }), undefined);
  });
});

test('reminder omits optional sections that are empty', () => {
  const reminder = formatProfileReminder(DEFAULT_PROFILE);
  assert.doesNotMatch(reminder, /ADHD mode|never write|known gaps/u);
  assert.match(reminder, /vocabulary: common; jargon: define-on-first-use/u);

  const full = formatProfileReminder({
    ...DEFAULT_PROFILE,
    forbidden_phrases: ['simply'],
    known_gap_types: [{ type: 'term', confidence: 0.8 }],
  });
  assert.match(full, /never write: simply/u);
  assert.match(full, /known gaps: term 0\.8/u);
});
