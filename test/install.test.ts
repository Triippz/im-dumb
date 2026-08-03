import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { installSkill, parseSkillVersion, resolveSkillPackageDir } from '../src/install.ts';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const skillSource = path.join(repoRoot, 'skill', 'im-dumb');
const packageVersion = (JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string }).version;

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'im-dumb-install-'));
}

test('parseSkillVersion: reads metadata.version from frontmatter', () => {
  assert.equal(parseSkillVersion(readFileSync(path.join(skillSource, 'SKILL.md'), 'utf8')), packageVersion);
});

test('resolveSkillPackageDir: finds skill/im-dumb from repo layout', () => {
  const resolved = resolveSkillPackageDir({ moduleUrl: import.meta.url, repoRootHint: repoRoot });
  assert.equal(resolved, skillSource);
});

test('installSkill: copies tree and reports installed', () => {
  const dest = path.join(tempDir(), 'im-dumb');
  const result = installSkill({ sourceDir: skillSource, destDir: dest });
  assert.equal(result.action, 'installed');
  assert.equal(result.version, packageVersion);
  const installedSkill = readFileSync(path.join(dest, 'SKILL.md'), 'utf8');
  assert.equal(installedSkill.includes('name: im-dumb'), true);
  assert.match(installedSkill, /node '.*\/scripts\/profile\.js' load/);
  assert.ok(readFileSync(path.join(dest, 'scripts', 'profile.js'), 'utf8').length > 0);
});

test('installSkill: materialized command safely quotes a special-character path', () => {
  const root = tempDir();
  const dest = path.join(root, "im dumb $cash 'quote'");
  installSkill({ sourceDir: skillSource, destDir: dest });
  const skill = readFileSync(path.join(dest, 'SKILL.md'), 'utf8');
  const command = /`(node '[^`]+ load)`/.exec(skill)?.[1];
  assert.match(skill, /node '.*\$cash '\\''quote'\\''\/scripts\/profile\.js' load/);
  assert.ok(command);
  const result = spawnSync('sh', ['-c', command], { env: { ...process.env, IM_DUMB_PROFILE: path.join(root, 'profile.json') } });
  assert.equal(result.status, 1);
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
  assert.equal(second.reason, 'materialized script path');
  assert.match(readFileSync(skill, 'utf8'), /node '.*\/scripts\/profile\.js' load/);
});

test('installSkill: same version restores a missing bundled script', () => {
  const dest = path.join(tempDir(), 'im-dumb');
  installSkill({ sourceDir: skillSource, destDir: dest });
  rmSync(path.join(dest, 'scripts', 'profile.js'));
  const result = installSkill({ sourceDir: skillSource, destDir: dest });
  assert.equal(result.action, 'repaired');
  assert.equal(result.reason, 'missing bundled script');
  assert.ok(readFileSync(path.join(dest, 'scripts', 'profile.js'), 'utf8').length > 0);
});

test('installSkill: refuses markdown symlinks during same-version repair', () => {
  const root = tempDir();
  const dest = path.join(root, 'im-dumb');
  const outside = path.join(root, 'outside.md');
  installSkill({ sourceDir: skillSource, destDir: dest });
  writeFileSync(outside, 'outside');
  symlinkSync(outside, path.join(dest, 'references', 'outside.md'));
  assert.throws(() => installSkill({ sourceDir: skillSource, destDir: dest }), /materialize symlink/);
  assert.equal(readFileSync(outside, 'utf8'), 'outside');
});

test('installSkill: removes a fresh tree when materialization rejects a source symlink', () => {
  const root = tempDir();
  const source = path.join(root, 'source');
  const dest = path.join(root, 'im-dumb');
  cpSync(skillSource, source, { recursive: true });
  symlinkSync(path.join(root, 'outside.md'), path.join(source, 'references', 'outside.md'));
  assert.throws(() => installSkill({ sourceDir: source, destDir: dest }), /materialize symlink/);
  assert.equal(existsSync(dest), false);
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
  assert.equal(result.version, packageVersion);
});
