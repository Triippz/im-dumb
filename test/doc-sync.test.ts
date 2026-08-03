import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
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

test('README preserves hero image and links the npm badge to the package', () => {
  assert.match(readme, /<img src="assets\/im-dumb-full\.png"/);
  assert.match(readme, /npmjs\.com\/package\/im-dumb/);
  assert.match(readme, /img\.shields\.io\/npm\/v\/im-dumb/);
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

test('README documents the installer CLI and the owner-gated publish step', () => {
  const install = section(readme, '## Install');
  assert.match(install, /install-cli\.js/);
  assert.match(install, /npx im-dumb/i);
  assert.match(install, /owner-authorized/i);
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

test('README discloses the spot-check and token-overhead results honestly', () => {
  const status = section(readme, '## Evaluation status');
  assert.match(status, /0 of 5/);
  assert.match(status, /single-trial/i);
  assert.match(status, /-12\.56%/);
  assert.match(status, /three individual cases exceed/i);
  assert.doesNotMatch(readme, /production[- ]ready/i);
});

test('README records what is built and how releases are cut', () => {
  const built = section(readme, '## What is built');
  assert.match(built, /\*\*Packaging:\*\*/);
  assert.match(built, /\*\*Learning assets:\*\*/);
  assert.match(built, /\*\*Release and governance:\*\*/);
  assert.match(built, /published to npm by an owner-authorized release run/i);
  assert.match(built, /Audio and video are out of scope/i);
  assert.match(built, /second explicit opt-in/i);
});

test('shipped docs cite no planning coordinates', () => {
  for (const [name, text] of [['README.md', readme], ['AGENTS.md', agents]] as const) {
    assert.doesNotMatch(text, /\bM[1-6]\b/u, `${name} should not cite milestone ids`);
    assert.doesNotMatch(text, /(?:^|\s)#\d+\b/u, `${name} should not cite PR or issue numbers`);
    assert.doesNotMatch(text, /\u2014/u, `${name} should not use em dashes`);
  }
});

test('shipped skill text and source cite no planning coordinates', () => {
  const roots = ['skill/im-dumb', 'src', '.github'];
  const files = execFileSync('git', ['ls-files', ...roots], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = readFileSync(path.join(repoRoot, file), 'utf8');
    assert.doesNotMatch(text, /\u2014/u, `${file} should not use em dashes`);
    assert.doesNotMatch(text, /(?:^|\s)#\d+\b/u, `${file} should not cite PR or issue numbers`);
  }
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

test('AGENTS installer contract section is marked implemented and published', () => {
  assert.match(agents, /## Installer contract \(v1, implemented, published\)/);
});

test('CLAUDE.md remains exactly the AGENTS.md import', () => {
  assert.equal(claude.trim(), '@AGENTS.md');
});
