import { existsSync } from 'node:fs';
import path from 'node:path';

export type HarnessId = 'claude' | 'cursor' | 'pi' | 'codex';
export type InstallScope = 'global' | 'project';

export interface DetectedHarness {
  id: HarnessId;
  /** Marker path that triggered detection. */
  markerPath: string;
}

export interface PathRoots {
  homeDir: string;
  projectRoot: string;
  codexHome?: string;
}

const MARKERS: ReadonlyArray<{ id: HarnessId; rel: string }> = [
  { id: 'claude', rel: '.claude' },
  { id: 'cursor', rel: '.cursor' },
  { id: 'pi', rel: path.join('.pi', 'agent') },
  { id: 'pi', rel: '.pi' },
  { id: 'pi', rel: '.agents' },
  { id: 'codex', rel: '.codex' },
];

export function detectHarnesses(roots: PathRoots): DetectedHarness[] {
  const byId = new Map<HarnessId, DetectedHarness>();
  for (const root of [roots.homeDir, roots.projectRoot]) {
    for (const marker of MARKERS) {
      if (byId.has(marker.id) || (marker.id === 'codex' && root !== roots.homeDir)) continue;
      const markerPath = marker.id === 'codex'
        ? detectCodexHome(roots.codexHome, roots.homeDir)
        : path.join(root, marker.rel);
      if (!markerPath || !existsSync(markerPath)) continue;
      byId.set(marker.id, { id: marker.id, markerPath });
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export interface Destination {
  harness: HarnessId;
  destDir: string;
  viaSharedAgents: boolean;
}

export function resolveInstallDestinations(options: {
  targets: readonly HarnessId[];
  scope: InstallScope;
  homeDir: string;
  projectRoot: string;
  preferAgents: boolean;
  codexHome?: string;
}): Destination[] {
  if (options.scope === 'project' && options.targets.includes('codex')) {
    throw new Error('Codex supports global installation only');
  }

  const base = options.scope === 'global' ? options.homeDir : options.projectRoot;
  const agentsSkills = path.join(base, '.agents', 'skills');
  const useShared = options.preferAgents || existsSync(agentsSkills);
  const sharedDest = path.join(agentsSkills, 'im-dumb');

  return options.targets.map((id) => {
    // Claude Code and Codex load only their native skill roots.
    if (id === 'claude' || id === 'codex' || !useShared) {
      return {
        harness: id,
        destDir: perHarnessDest(id, options.scope, options.homeDir, options.projectRoot, options.codexHome),
        viaSharedAgents: false,
      };
    }
    return { harness: id, destDir: sharedDest, viaSharedAgents: true };
  });
}

function perHarnessDest(
  harness: HarnessId,
  scope: InstallScope,
  homeDir: string,
  projectRoot: string,
  codexHome?: string,
): string {
  if (harness === 'claude' || harness === 'cursor') {
    return path.join(scope === 'global' ? homeDir : projectRoot, `.${harness}`, 'skills', 'im-dumb');
  }
  if (harness === 'codex') {
    return path.join(resolveCodexHome(codexHome, homeDir), 'skills', 'im-dumb');
  }
  if (scope === 'global') {
    return path.join(homeDir, '.pi', 'agent', 'skills', 'im-dumb');
  }
  return path.join(projectRoot, '.pi', 'skills', 'im-dumb');
}

function resolveCodexHome(codexHome: string | undefined, homeDir: string): string {
  const root = codexHome ?? path.join(homeDir, '.codex');
  if (!path.isAbsolute(root)) throw new Error('CODEX_HOME must be an absolute path');
  return path.resolve(root);
}

function detectCodexHome(codexHome: string | undefined, homeDir: string): string | undefined {
  try {
    return resolveCodexHome(codexHome, homeDir);
  } catch {
    return undefined;
  }
}

export function parseTargets(raw: string): HarnessId[] {
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error('--targets must list at least one harness');
  const allowed = new Set<string>(['claude', 'cursor', 'pi', 'codex']);
  for (const part of parts) {
    if (!allowed.has(part)) throw new Error(`unknown target "${part}"`);
  }
  return [...new Set(parts)] as HarnessId[];
}
