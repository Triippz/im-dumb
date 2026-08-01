import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
const agents = readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
const claude = readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8');

function section(content: string, heading: string): string {
  const start = content.indexOf(heading);
  assert.notEqual(start, -1, `missing heading "${heading}"`);
  const end = content.indexOf('\n## ', start + heading.length);
  return content.slice(start, end === -1 ? undefined : end);
}

test('README preserves hero image and pre-release badge', () => {
  assert.match(readme, /<img src="assets\/im-dumb-full\.png"/);
  assert.match(readme, /status-pre--release/);
});

test('README documents profile location and IM_DUMB_PROFILE override together', () => {
  assert.match(
    readme,
    /`~\/\.im-dumb\/profile\.json`[^\n]*`IM_DUMB_PROFILE`|`IM_DUMB_PROFILE`[^\n]*`~\/\.im-dumb\/profile\.json`/,
    'README should mention the profile path and its env override near each other',
  );
});

test('README states the vocabulary_level field and its three exact enum values', () => {
  assert.match(readme, /`vocabulary_level`/);
  assert.match(readme, /`common`/);
  assert.match(readme, /`technical-ok`/);
  assert.match(readme, /`expert`/);
});

test('README documents the M4 installer CLI and unpublished npm status', () => {
  const install = section(readme, '## Install');
  assert.match(install, /install-cli\.js/);
  assert.match(install, /private:\s*true|not on npm/i);
  assert.match(install, /M6/);
});

test('README qualifies npx download network use vs invocation-time no-network guarantee', () => {
  const security = section(readme, '## Security');
  assert.match(security, /npx im-dumb[\s\S]{0,200}network/i, 'should note npx needs network to download');
  assert.match(security, /no outbound network calls/i, 'should keep the invocation-time no-network guarantee');
});

test('README keeps the manual hosted-upload statement', () => {
  assert.match(readme, /[Hh]osted upload[\s\S]{0,80}(out of scope|manual)/);
});

test('README links both M1 evidence reports', () => {
  assert.match(readme, /\(eval\/baselines\/m1-token-overhead-report\.md\)/);
  assert.match(readme, /\(eval\/baselines\/m1-live-spot-check\.md\)/);
});

test('README links the eval stack map', () => {
  assert.match(readme, /\(eval\/README\.md\)/);
});

test('README discloses the M1 spot-check and token-overhead results honestly', () => {
  const status = section(readme, '## M1 evaluation status');
  assert.match(status, /0 of 5/);
  assert.match(status, /single-trial/i);
  assert.match(status, /-12\.56%/);
  assert.match(status, /three individual cases exceed/i);
  assert.doesNotMatch(readme, /production[- ]ready/i);
});

test('README roadmap marks M4/M5 shipped state and keeps M6 ahead', () => {
  const roadmap = section(readme, '## Roadmap');
  assert.match(roadmap, /\*\*M4[^*]*\*\*/);
  assert.match(roadmap, /\*\*M5[^*]*\*\*/);
  assert.match(roadmap, /\*\*M6:\*\*/);
  assert.match(roadmap, /slides and AV still ahead/i);
});

test('AGENTS repo layout is labeled actual and omits a separate installer/ directory', () => {
  const layout = section(agents, '## Repo layout');
  assert.match(layout, /## Repo layout \(actual\)/);
  const codeBlockMatch = /```\n([\s\S]*?)\n```/.exec(layout);
  assert.ok(codeBlockMatch, 'repo layout section should contain a fenced code block');
  const block = codeBlockMatch![1]!;
  assert.doesNotMatch(block, /installer\//);
  for (const entry of ['docs/plans/', 'eval/', 'src/', 'test/', 'skill/im-dumb/', 'AGENTS.md', 'CLAUDE.md', 'README.md']) {
    assert.ok(block.includes(entry), `layout block should list "${entry}"`);
  }
  assert.match(layout, /install-cli|no separate `installer\/`/i);
});

test('AGENTS installer contract section is marked implemented but unpublished', () => {
  assert.match(agents, /## Installer contract \(v1 — implemented, unpublished\)/);
});

test('CLAUDE.md remains exactly the AGENTS.md import', () => {
  assert.equal(claude.trim(), '@AGENTS.md');
});
