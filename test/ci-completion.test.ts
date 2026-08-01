import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');

function readJson(relPath: string): { scripts: Record<string, string> } {
  return JSON.parse(readFileSync(path.join(repoRoot, relPath), 'utf8')) as { scripts: Record<string, string> };
}

function readText(relPath: string): string {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

// ---------------------------------------------------------------------------
// M1 Step 10 — CI completion (docs/plans/m1-profile-and-language-rules.md,
// Step 10 / D4 / D8 / D14 / D15). These are contract tests over package.json
// and .github/workflows/ci.yml text, not re-tests of checker/golden logic
// (covered elsewhere) -- they exist so the CI wiring itself can't silently
// drift or get deleted without a test failing.
// ---------------------------------------------------------------------------

test('package.json declares the M1 step-10 CI verification scripts', () => {
  const pkg = readJson('package.json');
  assert.equal(pkg.scripts['check:skill'], 'node dist/check-cli.js --file skill/im-dumb/SKILL.md --skill-doc');
  assert.equal(pkg.scripts['verify:golden'], 'node --test test/golden-dataset.test.ts');
  assert.equal(pkg.scripts['verify:dist-sync'], 'diff -u dist/profile.js skill/im-dumb/scripts/profile.js');
  assert.equal(pkg.scripts['eval:smoke'], 'node src/eval-runner.ts --dry-run');
  assert.equal(pkg.scripts['eval:smoke:live'], 'node src/eval-runner.ts --live');
});

test('CI copies dist into an isolated ESM sandbox and runs Layer 1 from a separate empty directory', () => {
  const ci = readText('.github/workflows/ci.yml');
  assert.match(ci, /sandbox="\$\(mktemp -d\)"/);
  assert.match(ci, /run_dir="\$\(mktemp -d\)"/);
  assert.match(ci, /trap 'rm -rf "\$sandbox" "\$run_dir"' EXIT/);
  assert.match(ci, /cp -R "\$\{\{\s*github\.workspace\s*\}\}\/dist\/\." "\$sandbox\/dist\/"/);
  assert.match(ci, /printf '\{"type":"module"\}\\n' > "\$sandbox\/package\.json"/);
  assert.match(ci, /test ! -e "\$sandbox\/node_modules"/);
  assert.match(ci, /cd "\$run_dir"[\s\S]{0,80}test ! -e node_modules/);
  assert.match(
    ci,
    /node "\$sandbox\/dist\/check-cli\.js" --file "\$\{\{\s*github\.workspace\s*\}\}\/skill\/im-dumb\/SKILL\.md" --skill-doc/,
  );
});

test('CI verifies golden schema and manifest drift through the focused TypeScript gate', () => {
  const ci = readText('.github/workflows/ci.yml');
  assert.match(ci, /run: npm run verify:golden/);
});

test('CI verifies dist/profile.js is byte-for-byte in sync with the committed skill bundle', () => {
  const ci = readText('.github/workflows/ci.yml');
  assert.match(ci, /run: npm run verify:dist-sync/);
});

test('the new CI verification steps run inside the existing node 24.x/26.x build job, not a separate job', () => {
  const ci = readText('.github/workflows/ci.yml');
  const buildStart = ci.indexOf('\n  build:');
  const liveStart = ci.indexOf('\n  eval-smoke-live:');
  assert.ok(buildStart >= 0, 'expected a top-level "build:" job');
  const buildJob = liveStart > buildStart ? ci.slice(buildStart, liveStart) : ci.slice(buildStart);
  assert.match(buildJob, /node: \[24\.x, 26\.x\]/);
  for (const needle of ['verify:golden', 'verify:dist-sync', '--skill-doc', 'eval:smoke']) {
    assert.ok(buildJob.includes(needle), `expected build job to include "${needle}"`);
  }
  assert.ok(!buildJob.includes('eval:smoke:live'), 'live smoke belongs in the gated job');
});

test('CI live smoke job is gated on JUDGE_SMOKE_ENABLED and judge secrets', () => {
  const ci = readText('.github/workflows/ci.yml');
  assert.match(ci, /eval-smoke-live:/);
  assert.match(ci, /vars\.JUDGE_SMOKE_ENABLED == 'true'/);
  assert.match(ci, /secrets\.JUDGE_API_KEY/);
  assert.match(ci, /npm run eval:smoke:live/);
});

test('CI still preserves SHA-pinned actions and the semantic PR-title check', () => {
  const ci = readText('.github/workflows/ci.yml');
  assert.match(ci, /uses: actions\/checkout@[0-9a-f]{40} # v7\.0\.1/);
  assert.match(ci, /uses: actions\/setup-node@[0-9a-f]{40} # v6\.4\.0/);
  assert.match(ci, /uses: amannn\/action-semantic-pull-request@[0-9a-f]{40} # v6\.1\.1/);
});
