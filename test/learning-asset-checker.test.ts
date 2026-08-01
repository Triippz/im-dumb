import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkLearningAsset, detectAssetFormat } from '../src/checkers.ts';

const GOOD_MD = [
  '# How DNS resolves a name',
  '',
  'DNS turns a website name into a number your computer can dial.',
  '',
  '1. Your computer asks a nearby helper for the number.',
  '2. The helper asks the top-level servers.',
  '3. The answer comes back and gets saved for next time.',
  '',
  'Profile applied: short sentences, no unexplained jargon.',
].join('\n');

const GOOD_HTML = [
  '<article>',
  '  <h1>How DNS resolves a name</h1>',
  '  <section>',
  '    <p>DNS turns a website name into a number your computer can dial.</p>',
  '  </section>',
  '  <section>',
  '    <p>Profile applied: short sentences, no unexplained jargon.</p>',
  '  </section>',
  '</article>',
].join('\n');

test('detectAssetFormat: html when article/h1 tags present, else markdown', () => {
  assert.equal(detectAssetFormat(GOOD_HTML), 'html');
  assert.equal(detectAssetFormat(GOOD_MD), 'markdown');
});

test('checkLearningAsset: well-formed markdown asset has no violations', () => {
  assert.deepEqual(checkLearningAsset(GOOD_MD, 'markdown'), []);
});

test('checkLearningAsset: well-formed html asset has no violations', () => {
  assert.deepEqual(checkLearningAsset(GOOD_HTML, 'html'), []);
});

test('checkLearningAsset: markdown missing H1 title is an error', () => {
  const violations = checkLearningAsset(GOOD_MD.replace('# How DNS resolves a name', 'How DNS resolves a name'), 'markdown');
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.checker, 'learning-asset');
  assert.equal(violations[0]?.severity, 'error');
  assert.match(violations[0]?.message ?? '', /h1|title/i);
});

test('checkLearningAsset: markdown missing step list is an error', () => {
  const noSteps = ['# Title', '', 'Overview line.', '', 'Profile applied: short sentences.'].join('\n');
  const violations = checkLearningAsset(noSteps, 'markdown');
  assert.ok(violations.some((v) => /step/i.test(v.message)));
});

test('checkLearningAsset: missing profile-applied note is an error in both formats', () => {
  const md = checkLearningAsset(GOOD_MD.replace(/^Profile applied.*$/m, 'Done.'), 'markdown');
  const html = checkLearningAsset(GOOD_HTML.replace(/Profile applied[^<]*/, 'Done.'), 'html');
  assert.ok(md.some((v) => /profile applied/i.test(v.message)));
  assert.ok(html.some((v) => /profile applied/i.test(v.message)));
});

test('checkLearningAsset: html without article wrapper or sections is an error', () => {
  const bare = '<h1>Title</h1><p>Profile applied: short sentences.</p>';
  const violations = checkLearningAsset(bare, 'html');
  assert.ok(violations.some((v) => /article/i.test(v.message)));
  assert.ok(violations.some((v) => /section/i.test(v.message)));
});

test('checkLearningAsset: html with external script or stylesheet is an error', () => {
  const withScript = GOOD_HTML.replace('</article>', '  <script src="https://cdn.example.com/a.js"></script>\n</article>');
  const withCss = GOOD_HTML.replace('</article>', '  <link rel="stylesheet" href="https://cdn.example.com/a.css">\n</article>');
  assert.ok(checkLearningAsset(withScript, 'html').some((v) => /external/i.test(v.message)));
  assert.ok(checkLearningAsset(withCss, 'html').some((v) => /external/i.test(v.message)));
});
