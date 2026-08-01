import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveInstallDestinations } from '../src/harness-detect.ts';
import { installSkill } from '../src/install.ts';
import { DEFAULT_PROFILE } from '../src/profile.ts';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const skillSource = path.join(repoRoot, 'skill', 'im-dumb');

function markdownFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith('.md') ? [file] : [];
  });
}

test('installed skill is portable across Claude, Cursor, Codex, and Pi roots', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'im-dumb-harness-matrix-'));
  const project = path.join(root, 'project');
  mkdirSync(project);
  const destinations = resolveInstallDestinations({
    targets: ['claude', 'cursor', 'codex', 'pi'],
    scope: 'global',
    homeDir: root,
    projectRoot: project,
    preferAgents: false,
  });

  for (const destination of destinations) {
    installSkill({ sourceDir: skillSource, destDir: destination.destDir });
    const skill = readFileSync(path.join(destination.destDir, 'SKILL.md'), 'utf8');
    assert.match(skill, /^name: im-dumb$/m, `${destination.harness}: discovery name`);
    assert.doesNotMatch(skill, /\{\{IM_DUMB_PROFILE_SCRIPT\}\}/, `${destination.harness}: script path materialized`);
    assert.match(skill, /## Load the profile/, `${destination.harness}: core prompt present`);
    for (const reference of ['references/onboarding.md', 'references/comprehension.md', 'references/learning-assets.md']) {
      assert.ok(skill.includes(`\`${reference}\``), `${destination.harness}: names ${reference}`);
      assert.ok(existsSync(path.join(destination.destDir, reference)), `${destination.harness}: ${reference} exists`);
    }

    const profilePath = path.join(root, `${destination.harness}.json`);
    const script = path.join(destination.destDir, 'scripts', 'profile.js');
    const env = { ...process.env, IM_DUMB_PROFILE: profilePath };
    const missing = spawnSync(process.execPath, [script, 'load'], { cwd: project, env, encoding: 'utf8' });
    assert.equal(missing.status, 1, `${destination.harness}: missing profile stays typed`);
    assert.equal(JSON.parse(missing.stdout).error, 'missing');

    writeFileSync(profilePath, JSON.stringify(DEFAULT_PROFILE));
    const result = spawnSync(process.execPath, [script, 'load'], { cwd: project, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `${destination.harness}: profile script executes from project cwd`);
    const loaded = JSON.parse(result.stdout);
    assert.equal(loaded.profile.schema_version, 1);
    assert.deepEqual(loaded.warnings, []);

    for (const file of markdownFiles(destination.destDir)) {
      const content = readFileSync(file, 'utf8');
      assert.doesNotMatch(content, /\{\{IM_DUMB_PROFILE_SCRIPT\}\}/, `${file}: script path materialized`);
      for (const match of content.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
        const target = path.resolve(path.dirname(file), match[1]!);
        assert.ok(target.startsWith(`${destination.destDir}${path.sep}`), `${file}: reference stays in skill tree`);
        assert.ok(existsSync(target), `${file}: reference exists`);
      }
    }
  }
});
