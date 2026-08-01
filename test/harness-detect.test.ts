import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  detectHarnesses,
  resolveInstallDestinations,
  type HarnessId,
} from '../src/harness-detect.ts';

function tempRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'im-dumb-harness-'));
}

test('detectHarnesses: finds claude/cursor/pi markers under home and project', () => {
  const home = tempRoot();
  const project = tempRoot();
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  mkdirSync(path.join(home, '.cursor'), { recursive: true });
  mkdirSync(path.join(project, '.pi'), { recursive: true });
  mkdirSync(path.join(project, '.codex'), { recursive: true });

  const found = detectHarnesses({ homeDir: home, projectRoot: project });
  assert.deepEqual(
    found.map((item) => item.id).sort(),
    ['claude', 'codex', 'cursor', 'pi'],
  );
  assert.equal(found.find((item) => item.id === 'codex')?.installable, true);
  assert.equal(found.find((item) => item.id === 'claude')?.installable, true);
});

test('resolveInstallDestinations: per-harness paths when .agents/skills absent', () => {
  const home = tempRoot();
  const project = tempRoot();
  const dests = resolveInstallDestinations({
    targets: ['claude', 'cursor', 'pi', 'codex'],
    scope: 'global',
    homeDir: home,
    projectRoot: project,
    preferAgents: false,
  });
  assert.equal(dests.length, 4);
  assert.ok(dests.some((d) => d.destDir === path.join(home, '.claude', 'skills', 'im-dumb')));
  assert.ok(dests.some((d) => d.destDir === path.join(home, '.cursor', 'skills', 'im-dumb')));
  assert.ok(dests.some((d) => d.destDir === path.join(home, '.pi', 'agent', 'skills', 'im-dumb')));
  assert.ok(dests.some((d) => d.destDir === path.join(home, '.codex', 'skills', 'im-dumb')));
});

test('resolveInstallDestinations: shared .agents/skills collapses cursor+pi, not claude', () => {
  const home = tempRoot();
  const project = tempRoot();
  mkdirSync(path.join(home, '.agents', 'skills'), { recursive: true });
  const dests = resolveInstallDestinations({
    targets: ['claude', 'cursor', 'pi', 'codex'] as HarnessId[],
    scope: 'global',
    homeDir: home,
    projectRoot: project,
    preferAgents: false,
  });
  const byHarness = Object.fromEntries(dests.map((d) => [d.harness, d]));
  assert.equal(byHarness.claude?.destDir, path.join(home, '.claude', 'skills', 'im-dumb'));
  assert.equal(byHarness.claude?.viaSharedAgents, false);
  assert.equal(byHarness.cursor?.destDir, path.join(home, '.agents', 'skills', 'im-dumb'));
  assert.equal(byHarness.pi?.destDir, path.join(home, '.agents', 'skills', 'im-dumb'));
  assert.equal(byHarness.cursor?.viaSharedAgents, true);
  assert.equal(byHarness.codex?.destDir, path.join(home, '.codex', 'skills', 'im-dumb'));
  assert.equal(byHarness.codex?.viaSharedAgents, false);
});

test('resolveInstallDestinations: project scope uses project root', () => {
  const home = tempRoot();
  const project = tempRoot();
  const dests = resolveInstallDestinations({
    targets: ['claude'],
    scope: 'project',
    homeDir: home,
    projectRoot: project,
    preferAgents: false,
  });
  assert.equal(dests[0]?.destDir, path.join(project, '.claude', 'skills', 'im-dumb'));
});

test('resolveInstallDestinations: Codex uses CODEX_HOME and rejects unverified project scope', () => {
  const home = tempRoot();
  const codexHome = path.join(home, 'custom-codex');
  const [destination] = resolveInstallDestinations({
    targets: ['codex'],
    scope: 'global',
    homeDir: home,
    projectRoot: tempRoot(),
    preferAgents: false,
    codexHome,
  });
  assert.equal(destination?.destDir, path.join(codexHome, 'skills', 'im-dumb'));
  assert.throws(() => resolveInstallDestinations({
    targets: ['codex'], scope: 'project', homeDir: home, projectRoot: tempRoot(), preferAgents: false,
  }), /global installation only/);
});

test('detectHarnesses: empty roots → empty list', () => {
  const home = tempRoot();
  writeFileSync(path.join(home, 'readme.txt'), 'no harness markers');
  assert.deepEqual(detectHarnesses({ homeDir: home, projectRoot: home }), []);
});
