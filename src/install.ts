import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_RE = /^metadata:\s*\n(?:[ \t]+.+\n)*?[ \t]+version:\s*([^\s#]+)/m;
const SKILL_NAME = 'im-dumb';

export type InstallAction = 'installed' | 'upgraded' | 'repaired' | 'skipped';

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
      if (!existsSync(path.join(options.destDir, 'scripts', 'profile.js'))) {
        rmSync(options.destDir, { recursive: true, force: true });
        installTree(options.sourceDir, options.destDir);
        return {
          action: 'repaired',
          destDir: options.destDir,
          version,
          previousVersion,
          reason: 'missing bundled script',
        };
      }
      const repaired = materializeSkillPaths(options.destDir);
      return {
        action: repaired ? 'repaired' : 'skipped',
        destDir: options.destDir,
        version,
        previousVersion,
        reason: repaired ? 'materialized script path' : 'same version',
      };
    }
    rmSync(options.destDir, { recursive: true, force: true });
    installTree(options.sourceDir, options.destDir);
    return {
      action: 'upgraded',
      destDir: options.destDir,
      version,
      previousVersion,
    };
  }

  installTree(options.sourceDir, options.destDir);
  return { action: 'installed', destDir: options.destDir, version };
}

function copyTree(sourceDir: string, destDir: string): void {
  mkdirSync(path.dirname(destDir), { recursive: true });
  cpSync(sourceDir, destDir, { recursive: true, force: true });
}

function installTree(sourceDir: string, destDir: string): void {
  try {
    copyTree(sourceDir, destDir);
    materializeSkillPaths(destDir);
  } catch (error) {
    rmSync(destDir, { recursive: true, force: true });
    throw error;
  }
}

/** Replace relative profile commands with a shell-safe installed path. */
function materializeSkillPaths(destDir: string): boolean {
  const script = shellQuote(path.join(destDir, 'scripts', 'profile.js'));
  let changed = false;
  for (const file of markdownFiles(destDir)) {
    const content = readFileSync(file, 'utf8');
    const materialized = content.replaceAll('node scripts/profile.js', `node ${script}`);
    if (materialized === content) continue;
    writeFileSync(file, materialized);
    changed = true;
  }
  return changed;
}

function markdownFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`refusing to materialize symlink: ${file}`);
    }
    return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith('.md') ? [file] : [];
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
