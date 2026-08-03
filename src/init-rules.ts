import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { resolveInstallDestinations } from './harness-detect.ts';

export const RULE_SENTINEL = 'im-dumb: apply the saved communication profile';

export type RuleTargetId = 'cursor' | 'agents';
export type RuleAction = 'added' | 'appended' | 'present' | 'overwritten' | 'would-write' | 'exists';

export interface RuleTarget {
  id: RuleTargetId;
  file: string;
  frontmatter: string;
  mode: 'replace' | 'append';
}

export const RULE_TARGETS: readonly RuleTarget[] = [
  {
    id: 'cursor',
    file: '.cursor/rules/im-dumb.mdc',
    frontmatter: '---\ndescription: "im-dumb, apply the saved communication profile to every answer"\nalwaysApply: true\n---\n\n',
    mode: 'replace',
  },
  {
    id: 'agents',
    file: 'AGENTS.md',
    frontmatter: '',
    mode: 'append',
  },
];

export interface RuleResult {
  id: RuleTargetId;
  file: string;
  action: RuleAction;
}

export function ruleBody(profileScript: string): string {
  return [
    '## im-dumb',
    '',
    `${RULE_SENTINEL}. Before replying, run \`node ${shellQuote(profileScript)} load\`.`,
    'Apply the returned profile to every answer: vocabulary level, jargon policy,',
    'sentence length cap, topics per paragraph, tone, output shape, ADHD mode, and',
    'forbidden phrases. Never read or edit the profile file directly.',
    '',
    'A missing profile means use the schema defaults and offer setup once. A profile',
    'that fails to load never blocks the answer.',
    '',
  ].join('\n');
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

export function initRules(options: {
  projectRoot: string;
  profileScript: string;
  dryRun?: boolean;
  force?: boolean;
  only?: readonly RuleTargetId[];
}): RuleResult[] {
  const body = ruleBody(options.profileScript);
  const targets = options.only
    ? RULE_TARGETS.filter((target) => options.only!.includes(target.id))
    : RULE_TARGETS;

  return targets.map((target): RuleResult => {
    const fullPath = path.join(options.projectRoot, target.file);
    const existing = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : null;

    if (existing !== null && existing.includes(RULE_SENTINEL) && !options.force) {
      return { id: target.id, file: target.file, action: 'present' };
    }
    if (existing !== null && target.mode === 'replace' && !options.force) {
      return { id: target.id, file: target.file, action: 'exists' };
    }

    const next = existing === null || target.mode === 'replace'
      ? target.frontmatter + body
      : `${existing}${existing.endsWith('\n') ? '' : '\n'}\n${body}`;

    if (options.dryRun) {
      return { id: target.id, file: target.file, action: 'would-write' };
    }

    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, next, { mode: 0o644 });

    if (existing === null) return { id: target.id, file: target.file, action: 'added' };
    if (options.force) return { id: target.id, file: target.file, action: 'overwritten' };
    return { id: target.id, file: target.file, action: target.mode === 'append' ? 'appended' : 'overwritten' };
  });
}

export function parseRuleTargets(value: string): RuleTargetId[] {
  const ids = value.split(',').map((item) => item.trim()).filter(Boolean);
  const known = RULE_TARGETS.map((target) => target.id) as string[];
  const unknown = ids.filter((id) => !known.includes(id));
  if (unknown.length > 0) throw new Error(`unknown rule target: ${unknown.join(', ')}`);
  if (ids.length === 0) throw new Error('--only requires at least one target');
  return ids as RuleTargetId[];
}

/**
 * A rule file outlives the process that wrote it, so it must name a script that
 * stays put. An npx run lives in a cache npm is free to delete.
 */
export function resolveInstalledProfileScript(options: {
  homeDir: string;
  projectRoot: string;
  codexHome?: string;
  packageDir: string;
}): string {
  const destinations = (['project', 'global'] as const).flatMap((scope) =>
    [false, true].flatMap((preferAgents) =>
      resolveInstallDestinations({
        targets: scope === 'global' ? ['claude', 'cursor', 'codex', 'pi'] : ['claude', 'cursor', 'pi'],
        scope,
        homeDir: options.homeDir,
        projectRoot: options.projectRoot,
        preferAgents,
        codexHome: options.codexHome,
      }),
    ),
  );

  for (const destination of destinations) {
    const script = path.join(destination.destDir, 'scripts', 'profile.js');
    if (existsSync(script)) return script;
  }

  const fallback = path.join(options.packageDir, 'scripts', 'profile.js');
  if (isEphemeral(fallback)) {
    throw new Error(
      'no installed skill found, and this copy lives in a cache that npm can delete. Run "im-dumb install" first, then "im-dumb init".',
    );
  }
  return fallback;
}

function isEphemeral(script: string): boolean {
  const parts = script.split(path.sep);
  return parts.includes('_npx') || parts.includes('.npm') || parts.includes('node_modules');
}
