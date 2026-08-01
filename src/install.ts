import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_RE = /^metadata:\s*\n(?:[ \t]+.+\n)*?[ \t]+version:\s*([^\s#]+)/m;
const SKILL_NAME = 'im-dumb';

export type InstallAction = 'installed' | 'upgraded' | 'skipped';

export interface InstallResult {
  action: InstallAction;
  destDir: string;
  version: string;
  previousVersion?: string;
  reason?: string;
}

export function parseSkillVersion(skillMd: string): string {
  const match = VERSION_RE.exec(skillMd);
  if (!match) throw new Error('SKILL.md missing metadata.version');
  return match[1]!;
}

export function resolveSkillPackageDir(options?: {
  moduleUrl?: string;
  repoRootHint?: string;
}): string {
  if (options?.repoRootHint) {
    const candidate = path.join(options.repoRootHint, 'skill', SKILL_NAME);
    if (existsSync(path.join(candidate, 'SKILL.md'))) return candidate;
  }

  const here = path.dirname(fileURLToPath(options?.moduleUrl ?? import.meta.url));
  const candidates = [
    path.resolve(here, '../skill', SKILL_NAME), // repo: src/ → skill/
    path.resolve(here, '../../skill', SKILL_NAME), // dist/ → skill/
    path.resolve(here, 'skill', SKILL_NAME),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'SKILL.md'))) return candidate;
  }
  throw new Error('could not locate skill/im-dumb package next to installer');
}

export function installSkill(options: {
  sourceDir: string;
  destDir: string;
}): InstallResult {
  const sourceSkill = path.join(options.sourceDir, 'SKILL.md');
  if (!existsSync(sourceSkill)) {
    throw new Error(`skill package missing SKILL.md: ${options.sourceDir}`);
  }
  const version = parseSkillVersion(readFileSync(sourceSkill, 'utf8'));
  const destSkill = path.join(options.destDir, 'SKILL.md');

  if (existsSync(destSkill)) {
    const previousVersion = parseSkillVersion(readFileSync(destSkill, 'utf8'));
    if (previousVersion === version) {
      return {
        action: 'skipped',
        destDir: options.destDir,
        version,
        previousVersion,
        reason: 'same version',
      };
    }
    rmSync(options.destDir, { recursive: true, force: true });
    copyTree(options.sourceDir, options.destDir);
    return {
      action: 'upgraded',
      destDir: options.destDir,
      version,
      previousVersion,
    };
  }

  copyTree(options.sourceDir, options.destDir);
  return { action: 'installed', destDir: options.destDir, version };
}

function copyTree(sourceDir: string, destDir: string): void {
  mkdirSync(path.dirname(destDir), { recursive: true });
  cpSync(sourceDir, destDir, { recursive: true, force: true });
}
