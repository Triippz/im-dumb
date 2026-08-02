import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');

function readText(relPath: string): string {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

const release = readText('.github/workflows/release.yml');

test('release runs on workflow_dispatch only, never on push or pull_request', () => {
  assert.match(release, /on:\s*\n\s*workflow_dispatch:/);
  assert.ok(!/^\s{2}push:/m.test(release), 'release must not trigger on push');
  assert.ok(!/^\s{2}pull_request:/m.test(release), 'release must not trigger on pull_request');
});

test('release defaults to a dry run and needs a second opt-in to publish', () => {
  assert.match(release, /dry_run:[\s\S]{0,160}default: true/);
  assert.match(release, /publish_npm:[\s\S]{0,200}default: false/);
  assert.match(release, /if: \$\{\{ !inputs\.dry_run && inputs\.publish_npm \}\}\n\s*env:[\s\S]{0,200}npm publish/);
});

test('the full offline suite gates the release before any version is written', () => {
  const gateSteps = release.slice(0, release.indexOf('Compute next version'));
  for (const step of [
    'npm run build',
    'npm run typecheck',
    'npm test',
    'npm run verify:golden',
    'npm run verify:dist-sync',
    'npm run check:skill',
    'npm run eval:smoke',
  ]) {
    assert.ok(gateSteps.includes(step), `expected "${step}" to run before the version step`);
  }
});

test('release keeps package, lockfile, and skill versions in sync and re-verifies dist', () => {
  assert.match(release, /release:prepare -- --write/);
  assert.match(release, /git add package\.json package-lock\.json skill\/im-dumb\/SKILL\.md CHANGELOG\.md/);
  const writeStep = release.slice(release.indexOf('Apply version, changelog, and tag'));
  assert.ok(writeStep.includes('npm run verify:dist-sync'), 'dist-sync must re-run after the version write');
  assert.match(writeStep, /git tag -a "v\$\{NEXT_VERSION\}" -m/);
  assert.match(writeStep, /git push origin HEAD --follow-tags/);
});

test('publish request validates package visibility and npm credentials before release mutation', () => {
  const preflight = release.slice(release.indexOf('Validate npm publication request'), release.indexOf('Apply version, changelog, and tag'));
  assert.match(preflight, /package\.json is private/);
  assert.match(preflight, /NPM_TOKEN is required/);
  assert.match(preflight, /npm whoami/);
  assert.ok(release.indexOf('Validate npm publication request') < release.indexOf('Apply version, changelog, and tag'));
});

test('package.json exposes release:prepare as a dry-run entrypoint', () => {
  const pkg = JSON.parse(readText('package.json')) as { scripts: Record<string, string>; private?: boolean };
  assert.equal(pkg.scripts['release:prepare'], 'node src/release-cli.ts');
  assert.equal(pkg.private, true, 'package stays private until a release is explicitly authorized');
});

test('governance plan documents the single override path', () => {
  const plan = readText('docs/plans/m6-release-governance.md');
  assert.match(plan, /override-gate/);
  assert.match(plan, /second approving review/i);
  assert.match(plan, /never applies to a\s*\n?\s*release run/i);
});
