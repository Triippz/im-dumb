import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');

function readJson(relPath: string): any {
  return JSON.parse(readFileSync(path.join(repoRoot, relPath), 'utf8'));
}

function readText(relPath: string): string {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

test('package.json declares the M1 step-1 scaffolding contract', () => {
  const pkg = readJson('package.json');
  assert.equal(pkg.name, 'im-dumb');
  assert.equal(pkg.version, '0.2.0');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.private, true);
  assert.equal(pkg.engines.node, '>=24');
  assert.equal(pkg.scripts.build, 'tsc -p tsconfig.build.json');
  assert.equal(pkg.scripts.typecheck, 'tsc --noEmit');
  assert.equal(pkg.scripts.test, "node --test 'test/**/*.test.ts'");
  assert.equal(pkg.bin?.['im-dumb'], './dist/install-cli.js');
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('skill/im-dumb/'));

  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ['@types/node', 'typescript']);
  assert.equal(pkg.devDependencies.typescript, '6.0.3');
  // exact-pinned (no ^ or ~ range) per D4's toolchain-pin policy
  assert.match(pkg.devDependencies['@types/node'], /^\d+\.\d+\.\d+$/);
});

test('tsconfig.json enforces the strict, dependency-free compile target', () => {
  const tsconfig = readJson('tsconfig.json');
  const co = tsconfig.compilerOptions;
  assert.equal(co.strict, true);
  assert.equal(co.target, 'es2023');
  assert.equal(co.module, 'nodenext');
  assert.equal(co.moduleResolution, 'nodenext');
  assert.equal(co.erasableSyntaxOnly, true);
  assert.equal(co.verbatimModuleSyntax, true);
  assert.equal(co.rewriteRelativeImportExtensions, true);
  assert.equal(co.outDir, 'dist');
  assert.deepEqual(tsconfig.include, ['src', 'test']);
});

test('tsconfig.build.json narrows the build (not typecheck) to src only, so dist only ever gets compiled skill scripts', () => {
  const buildConfig = readJson('tsconfig.build.json');
  assert.equal(buildConfig.extends, './tsconfig.json');
  assert.equal(buildConfig.compilerOptions.rootDir, 'src');
  assert.deepEqual(buildConfig.include, ['src']);
});

test('.gitattributes normalizes line endings to LF', () => {
  assert.match(readText('.gitattributes'), /eol=lf/);
});

test('.gitignore excludes build output and local artifacts', () => {
  const contents = readText('.gitignore');
  for (const entry of ['node_modules/', 'dist/', '.DS_Store']) {
    assert.ok(contents.includes(entry), `expected .gitignore to include ${entry}`);
  }
});

test('CI lints PR titles only on pull_request events', () => {
  const ci = readText('.github/workflows/ci.yml');
  assert.match(ci, /pr-title:\s*\n\s*if: github\.event_name == 'pull_request'/);
  assert.match(ci, /amannn\/action-semantic-pull-request@/);
});

test('CI builds, typechecks, and tests on push and pull_request across the node matrix', () => {
  const ci = readText('.github/workflows/ci.yml');
  assert.match(ci, /on:\s*\n\s*pull_request:/);
  assert.match(ci, /push:\s*\n\s*branches: \[main\]/);
  assert.match(ci, /node: \[24\.x, 26\.x\]/);
  assert.match(ci, /run: npm ci/);
  assert.match(ci, /run: npm run build/);
  assert.match(ci, /run: npm run typecheck/);
  assert.match(ci, /run: npm test/);
});
