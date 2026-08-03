import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  RULE_SENTINEL,
  resolveInstalledProfileScript,
  RULE_TARGETS,
  initRules,
  parseRuleTargets,
  ruleBody,
} from '../src/init-rules.ts';

const SCRIPT = '/home/someone/.claude/skills/im-dumb/scripts/profile.js';

function repo(): string {
  return mkdtempSync(path.join(tmpdir(), 'im-dumb-init-'));
}

function read(root: string, file: string): string {
  return readFileSync(path.join(root, file), 'utf8');
}

test('init writes an always-on cursor rule and appends to AGENTS.md', () => {
  const root = repo();
  const results = initRules({ projectRoot: root, profileScript: SCRIPT });
  assert.deepEqual(results.map((item) => item.action), ['added', 'added']);

  const cursor = read(root, '.cursor/rules/im-dumb.mdc');
  assert.match(cursor, /^---\n[\s\S]*alwaysApply: true\n---\n/u);
  assert.ok(cursor.includes(RULE_SENTINEL));
  assert.ok(cursor.includes(SCRIPT));

  assert.ok(read(root, 'AGENTS.md').includes(RULE_SENTINEL));
});

test('an existing AGENTS.md keeps its content and gains the rule once', () => {
  const root = repo();
  writeFileSync(path.join(root, 'AGENTS.md'), '# House rules\n\nExisting text.\n');

  const first = initRules({ projectRoot: root, profileScript: SCRIPT, only: ['agents'] });
  assert.equal(first[0]!.action, 'appended');
  const afterFirst = read(root, 'AGENTS.md');
  assert.ok(afterFirst.startsWith('# House rules'));
  assert.ok(afterFirst.includes(RULE_SENTINEL));

  const second = initRules({ projectRoot: root, profileScript: SCRIPT, only: ['agents'] });
  assert.equal(second[0]!.action, 'present');
  assert.equal(read(root, 'AGENTS.md'), afterFirst);
});

test('a hand-edited rule file is never clobbered without force', () => {
  const root = repo();
  mkdirSync(path.join(root, '.cursor', 'rules'), { recursive: true });
  writeFileSync(path.join(root, '.cursor/rules/im-dumb.mdc'), 'mine, do not touch\n');

  const skipped = initRules({ projectRoot: root, profileScript: SCRIPT, only: ['cursor'] });
  assert.equal(skipped[0]!.action, 'exists');
  assert.equal(read(root, '.cursor/rules/im-dumb.mdc'), 'mine, do not touch\n');

  const forced = initRules({ projectRoot: root, profileScript: SCRIPT, only: ['cursor'], force: true });
  assert.equal(forced[0]!.action, 'overwritten');
  assert.ok(read(root, '.cursor/rules/im-dumb.mdc').includes(RULE_SENTINEL));
});

test('a dry run reports what it would write and writes nothing', () => {
  const root = repo();
  const results = initRules({ projectRoot: root, profileScript: SCRIPT, dryRun: true });
  assert.deepEqual(results.map((item) => item.action), ['would-write', 'would-write']);
  for (const target of RULE_TARGETS) {
    assert.throws(() => read(root, target.file));
  }
});

test('the rule points at the profile script instead of restating profile values', () => {
  const body = ruleBody(SCRIPT);
  assert.ok(body.includes(`node ${SCRIPT} load`));
  assert.doesNotMatch(body, /sentence_length_cap:\s*\d/u);
  assert.match(body, /never read or edit the profile file directly/iu);
});

test('parseRuleTargets rejects unknown or empty selections', () => {
  assert.deepEqual(parseRuleTargets('cursor,agents'), ['cursor', 'agents']);
  assert.throws(() => parseRuleTargets('windsurf'), /unknown rule target/u);
  assert.throws(() => parseRuleTargets(''), /at least one target/u);
});

test('init points at an installed skill, never at a cache npm can delete', () => {
  const home = repo();
  const projectRoot = repo();
  const installed = path.join(home, '.claude', 'skills', 'im-dumb', 'scripts');
  mkdirSync(installed, { recursive: true });
  writeFileSync(path.join(installed, 'profile.js'), '// installed');

  assert.equal(
    resolveInstalledProfileScript({ homeDir: home, projectRoot, packageDir: '/anywhere' }),
    path.join(installed, 'profile.js'),
  );
});

test('init refuses to write a path inside the npx cache', () => {
  const home = repo();
  assert.throws(
    () => resolveInstalledProfileScript({
      homeDir: home,
      projectRoot: repo(),
      packageDir: '/home/someone/.npm/_npx/abc123/node_modules/im-dumb/skill/im-dumb',
    }),
    /Run "im-dumb install" first/u,
  );
});

test('a checkout outside any cache stays usable', () => {
  const home = repo();
  const packageDir = path.join(repo(), 'skill', 'im-dumb');
  assert.equal(
    resolveInstalledProfileScript({ homeDir: home, projectRoot: repo(), packageDir }),
    path.join(packageDir, 'scripts', 'profile.js'),
  );
});
