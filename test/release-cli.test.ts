import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const releaseCli = path.join(repoRoot, 'src', 'release-cli.ts');

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

test('release --write keeps package-lock root metadata in sync', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'im-dumb-release-'));
  try {
    mkdirSync(path.join(dir, 'skill', 'im-dumb'), { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), '{"name":"fixture","version":"0.2.0"}\n');
    writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({
      name: 'fixture', version: '0.2.0', lockfileVersion: 3,
      packages: { '': { name: 'fixture', version: '0.2.0' } },
    }, null, 2));
    writeFileSync(path.join(dir, 'skill', 'im-dumb', 'SKILL.md'), '---\nmetadata:\n  version: 0.2.0\n---\n');
    git(dir, 'init');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'add', '.');
    git(dir, 'commit', '-m', 'feat: fixture');

    execFileSync('node', [releaseCli, '--write'], { cwd: dir, stdio: 'ignore' });

    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version: string };
    const lock = JSON.parse(readFileSync(path.join(dir, 'package-lock.json'), 'utf8')) as { version: string; packages: Record<string, { version: string }> };
    assert.equal(pkg.version, '0.3.0');
    assert.equal(lock.version, '0.3.0');
    assert.equal(lock.packages[''].version, '0.3.0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
