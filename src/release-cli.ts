#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  computeNextVersion,
  parseConventionalSubjects,
  renderChangelogSection,
} from './release-version.ts';

const CHANGELOG_HEADER = '# Changelog\n\nAll notable changes, grouped from Conventional Commit history.\n';

function gitSubjects(fromRef: string | null): string[] {
  const range = fromRef ? `${fromRef}..HEAD` : 'HEAD';
  const raw = execFileSync('git', ['log', range, '--no-merges', '--format=%B%x00'], { encoding: 'utf8' });
  return raw.split('\u0000').map((entry) => entry.trim()).filter(Boolean);
}

function lastReleaseTag(): string | null {
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const repoRoot = process.cwd();

  const pkgPath = path.join(repoRoot, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

  const { bump, entries } = parseConventionalSubjects(gitSubjects(lastReleaseTag()));
  const nextVersion = computeNextVersion(pkg.version, bump);

  if (bump === 'none') {
    console.log(`bump: none (current ${pkg.version}), nothing to release`);
    process.exitCode = 1;
    return;
  }

  const isoDate = new Date().toISOString().slice(0, 10);
  const section = renderChangelogSection(nextVersion, isoDate, entries);

  console.log(`bump: ${bump}`);
  console.log(`current: ${pkg.version}`);
  console.log(`next: ${nextVersion}`);
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `bump=${bump}\nnext_version=${nextVersion}\n`, { flag: 'a' });
  }

  if (!write) {
    console.log('\n--- changelog preview (dry run; pass --write to apply) ---\n');
    console.log(section);
    return;
  }

  pkg.version = nextVersion;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  const lockPath = path.join(repoRoot, 'package-lock.json');
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
      version?: string;
      packages?: Record<string, { version?: string }>;
    };
    lock.version = nextVersion;
    if (lock.packages?.[''] !== undefined) lock.packages[''].version = nextVersion;
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  }

  const skillPath = path.join(repoRoot, 'skill', 'im-dumb', 'SKILL.md');
  const skill = readFileSync(skillPath, 'utf8');
  writeFileSync(skillPath, skill.replace(/(\n {2}version:\s*)[^\s#]+/, `$1${nextVersion}`), 'utf8');

  const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
  const existing = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : CHANGELOG_HEADER;
  const body = existing.startsWith('# Changelog') ? existing.slice(CHANGELOG_HEADER.length) : existing;
  writeFileSync(changelogPath, `${CHANGELOG_HEADER}\n${section}${body}`, 'utf8');

  console.log(`\nwrote package.json, package-lock.json (when present), SKILL.md metadata.version, and CHANGELOG.md at ${nextVersion}`);
}

main();
