import { existsSync } from 'node:fs';
import path from 'node:path';

export type HarnessId = 'claude' | 'cursor' | 'pi' | 'codex';
export type InstallScope = 'global' | 'project';

export interface DetectedHarness {
  id: HarnessId;
  /** Marker path that triggered detection. */
  markerPath: string;
  installable: boolean;
}

export interface PathRoots {
  homeDir: string;
  projectRoot: string;
}

const INSTALLABLE: ReadonlySet<HarnessId> = new Set(['claude', 'cursor', 'pi']);

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
      if (byId.has(marker.id)) continue;
      const markerPath = path.join(root, marker.rel);
      if (!existsSync(markerPath)) continue;
      byId.set(marker.id, {
        id: marker.id,
        markerPath,
        installable: INSTALLABLE.has(marker.id),
      });
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
}): Destination[] {
  for (const target of options.targets) {
    if (target === 'codex') {
      throw new Error('codex is detect-only in v1; install manually for local-shell mode');
    }
    if (!INSTALLABLE.has(target)) {
      throw new Error(`unsupported install target: ${target}`);
    }
  }

  const base = options.scope === 'global' ? options.homeDir : options.projectRoot;
  const agentsSkills = path.join(base, '.agents', 'skills');
  const useShared = options.preferAgents || existsSync(agentsSkills);
  const sharedDest = path.join(agentsSkills, 'im-dumb');

  return options.targets.map((harness) => {
    const id = harness as Exclude<HarnessId, 'codex'>;
    // Claude Code does not load .agents/skills; keep its native path.
    if (id === 'claude' || !useShared) {
      return {
        harness: id,
        destDir: perHarnessDest(id, options.scope, options.homeDir, options.projectRoot),
        viaSharedAgents: false,
      };
    }
    return { harness: id, destDir: sharedDest, viaSharedAgents: true };
  });
}

function perHarnessDest(
  harness: Exclude<HarnessId, 'codex'>,
  scope: InstallScope,
  homeDir: string,
  projectRoot: string,
): string {
  if (harness === 'claude') {
    const root = scope === 'global' ? homeDir : projectRoot;
    return path.join(root, '.claude', 'skills', 'im-dumb');
  }
  if (harness === 'cursor') {
    const root = scope === 'global' ? homeDir : projectRoot;
    return path.join(root, '.cursor', 'skills', 'im-dumb');
  }
  if (scope === 'global') {
    return path.join(homeDir, '.pi', 'agent', 'skills', 'im-dumb');
  }
  return path.join(projectRoot, '.pi', 'skills', 'im-dumb');
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
