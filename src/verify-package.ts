#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_OUTPUT = 'im-dumb install';

export function verifyPackedPackage(repoRoot: string, log: (line: string) => void = console.log): void {
  const workDir = mkdtempSync(path.join(tmpdir(), 'im-dumb-pack-'));
  try {
    const packed = execFileSync('npm', ['pack', '--pack-destination', workDir], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .pop();
    if (!packed) throw new Error('npm pack produced no tarball name');

    const prefix = path.join(workDir, 'prefix');
    execFileSync('npm', ['install', '--global', '--prefix', prefix, path.join(workDir, packed)], {
      stdio: 'ignore',
    });

    const bin = path.join(prefix, 'bin', 'im-dumb');
    const output = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
    if (!output.includes(REQUIRED_OUTPUT)) {
      throw new Error(`packed bin ran but never printed usage; got ${JSON.stringify(output.slice(0, 200))}`);
    }
    log(`packed bin works: ${packed}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function isDirectExecution(argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

if (isDirectExecution(process.argv[1])) {
  verifyPackedPackage(process.cwd());
}
