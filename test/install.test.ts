import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
  const installedSkill = readFileSync(path.join(dest, 'SKILL.md'), 'utf8');
  assert.equal(installedSkill.includes('name: im-dumb'), true);
  assert.match(installedSkill, /node '.*\/scripts\/profile\.js' load/);
  assert.ok(readFileSync(path.join(dest, 'scripts', 'profile.js'), 'utf8').length > 0);
});

test('installSkill: materialized command safely quotes a special-character path', () => {
  const root = tempDir();
  const dest = path.join(root, "im dumb $cash 'quote'");
  installSkill({ sourceDir: skillSource, destDir: dest });
  assert.match(readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), /node '.*\$cash '\\''quote'\\''\/scripts\/profile\.js' load/);
});

test('installSkill: profile script runs from a project cwd', () => {
  const root = tempDir();
  const dest = path.join(root, 'im-dumb');
  installSkill({ sourceDir: skillSource, destDir: dest });
  const project = path.join(root, 'project');
  mkdirSync(project);
  const result = spawnSync(process.execPath, [path.join(dest, 'scripts', 'profile.js'), 'load'], {
    cwd: project,
    env: { ...process.env, IM_DUMB_PROFILE: path.join(root, 'profile.json') },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error, 'missing');
});

test('installSkill: same version repairs legacy relative script commands', () => {
  const dest = path.join(tempDir(), 'im-dumb');
  assert.equal(installSkill({ sourceDir: skillSource, destDir: dest }).action, 'installed');
  const skill = path.join(dest, 'SKILL.md');
  writeFileSync(skill, readFileSync(skill, 'utf8').replace(/node '[^']+\/scripts\/profile\.js'/u, 'node scripts/profile.js'));
  const second = installSkill({ sourceDir: skillSource, destDir: dest });
  assert.equal(second.action, 'repaired');
  assert.equal(second.reason, 'same version');
  assert.match(readFileSync(skill, 'utf8'), /node '.*\/scripts\/profile\.js' load/);
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
