export type ReleaseBump = 'major' | 'minor' | 'patch' | 'none';

export interface ConventionalEntry {
  type: string;
  scope?: string;
  breaking: boolean;
  description: string;
}

export interface ParsedHistory {
  bump: ReleaseBump;
  entries: ConventionalEntry[];
}

const HEADER_RE = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s+(?<description>.+)$/;
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseConventionalSubjects(messages: readonly string[]): ParsedHistory {
  const entries: ConventionalEntry[] = [];
  let bump: ReleaseBump = 'none';

  for (const message of messages) {
    const [header = '', ...rest] = message.split('\n');
    const match = HEADER_RE.exec(header.trim());
    if (!match?.groups) continue;

    const breaking = match.groups.bang === '!' || /^BREAKING CHANGE:/m.test(rest.join('\n'));
    entries.push({
      type: match.groups.type!,
      scope: match.groups.scope,
      breaking,
      description: match.groups.description!.replace(/\s*\(#\d+\)$/, ''),
    });

    if (breaking) bump = 'major';
    else if (match.groups.type === 'feat' && bump !== 'major') bump = 'minor';
    else if (bump === 'none') bump = 'patch';
  }

  return { bump, entries };
}

export function computeNextVersion(current: string, bump: ReleaseBump): string {
  const match = SEMVER_RE.exec(current);
  if (!match) throw new Error(`current version "${current}" is not semver MAJOR.MINOR.PATCH`);
  if (bump === 'none') return current;

  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const GROUPS: ReadonlyArray<{ heading: string; match: (entry: ConventionalEntry) => boolean }> = [
  { heading: 'Breaking changes', match: (e) => e.breaking },
  { heading: 'Features', match: (e) => e.type === 'feat' },
  { heading: 'Fixes', match: (e) => e.type === 'fix' },
  { heading: 'Other', match: () => true },
];

export function renderChangelogSection(
  version: string,
  isoDate: string,
  entries: readonly ConventionalEntry[],
): string {
  const remaining = [...entries];
  const blocks: string[] = [`## ${version} - ${isoDate}`];

  for (const group of GROUPS) {
    const taken = remaining.filter(group.match);
    if (taken.length === 0) continue;
    for (const entry of taken) remaining.splice(remaining.indexOf(entry), 1);
    const lines = taken.map((entry) => `- ${entry.scope ? `**${entry.scope}:** ` : ''}${entry.description}`);
    blocks.push(`### ${group.heading}\n\n${lines.join('\n')}`);
  }

  return `${blocks.join('\n\n')}\n`;
}
