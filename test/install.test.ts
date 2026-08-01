import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { installSkill, parseSkillVersion, resolveSkillPackageDir } from '../src/install.ts';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const skillSource = path.join(repoRoot, 'skill', 'im-dumb');

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'im-dumb-install-'));
}

test('parseSkillVersion: reads metadata.version from frontmatter', () => {
  assert.equal(parseSkillVersion(readFileSync(path.join(skillSource, 'SKILL.md'), 'utf8')), '0.2.0');
});

test('resolveSkillPackageDir: finds skill/im-dumb from repo layout', () => {
  const resolved = resolveSkillPackageDir({ moduleUrl: import.meta.url, repoRootHint: repoRoot });
  assert.equal(resolved, skillSource);
});

test('installSkill: copies tree and reports installed', () => {
  const dest = path.join(tempDir(), 'im-dumb');
  const result = installSkill({ sourceDir: skillSource, destDir: dest });
  assert.equal(result.action, 'installed');
  assert.equal(result.version, '0.2.0');
  assert.equal(readFileSync(path.join(dest, 'SKILL.md'), 'utf8').includes('name: im-dumb'), true);
  assert.ok(readFileSync(path.join(dest, 'scripts', 'profile.js'), 'utf8').length > 0);
});

test('installSkill: same version is a no-op', () => {
  const dest = path.join(tempDir(), 'im-dumb');
  assert.equal(installSkill({ sourceDir: skillSource, destDir: dest }).action, 'installed');
  const second = installSkill({ sourceDir: skillSource, destDir: dest });
  assert.equal(second.action, 'skipped');
  assert.equal(second.reason, 'same version');
});

test('installSkill: different installed version upgrades', () => {
  const dest = path.join(tempDir(), 'im-dumb');
  mkdirSync(dest, { recursive: true });
  writeFileSync(
    path.join(dest, 'SKILL.md'),
    '---\nname: im-dumb\nmetadata:\n  version: 0.1.0\n---\n',
    'utf8',
  );
  const result = installSkill({ sourceDir: skillSource, destDir: dest });
  assert.equal(result.action, 'upgraded');
  assert.equal(result.previousVersion, '0.1.0');
  assert.equal(result.version, '0.2.0');
});
