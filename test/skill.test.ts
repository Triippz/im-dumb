import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { checkSkillFrontmatter } from '../src/checkers.ts';
import { DEFAULT_PROFILE } from '../src/profile.ts';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const skillDir = path.join(repoRoot, 'skill', 'im-dumb');
const skillMdPath = path.join(skillDir, 'SKILL.md');
const onboardingPath = path.join(skillDir, 'references', 'onboarding.md');
const comprehensionPath = path.join(skillDir, 'references', 'comprehension.md');
const scriptsDir = path.join(skillDir, 'scripts');

const skillMdContent = readFileSync(skillMdPath, 'utf8');
const packageVersion = (JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string }).version;
const onboardingContent = readFileSync(onboardingPath, 'utf8');
const comprehensionContent = readFileSync(comprehensionPath, 'utf8');
const combined = `${skillMdContent}\n${onboardingContent}\n${comprehensionContent}`;

function splitFrontmatterAndBody(content: string): { frontmatterText: string; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(content);
  assert.ok(match, 'SKILL.md must have opening and closing frontmatter delimiters');
  return { frontmatterText: match[1]!, body: match[2]! };
}

function extractTopLevel(frontmatterText: string, key: string): string | undefined {
  return new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(frontmatterText)?.[1]?.trim();
}

function extractNested(frontmatterText: string, parent: string, key: string): string | undefined {
  const parentMatch = new RegExp(`^${parent}:\\s*$`, 'm').exec(frontmatterText);
  if (!parentMatch) return undefined;
  return new RegExp(`^\\s+${key}:\\s*(.*)$`, 'm')
    .exec(frontmatterText.slice(parentMatch.index + parentMatch[0].length))?.[1]?.trim();
}

function section(content: string, heading: string): string {
  const marker = `## ${heading}`;
  const start = content.indexOf(marker);
  assert.notEqual(start, -1, `missing section "${heading}"`);
  const end = content.indexOf('\n## ', start + marker.length);
  return content.slice(start, end === -1 ? undefined : end);
}

function tableRows(content: string, heading: string): string[][] {
  return section(content, heading)
    .split('\n')
    .filter((line) => /^\|.*\|$/u.test(line) && !/^\|\s*---/u.test(line))
    .map((line) => line.slice(1, -1).split('|').map((cell) => cell.trim()));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertOrder(text: string, needles: readonly string[], label: string): void {
  let cursor = -1;
  for (const needle of needles) {
    const pattern = needle.split(/\s+/u).map(escapeRegExp).join('\\s+');
    const match = new RegExp(pattern).exec(text);
    assert.ok(match, `${label}: expected "${needle}"`);
    assert.ok(match.index > cursor, `${label}: "${needle}" must follow the previous item`);
    cursor = match.index;
  }
}

const { frontmatterText, body } = splitFrontmatterAndBody(skillMdContent);

// Frontmatter and D12.
test('skill directory, frontmatter name, description, and version satisfy the shared contract', () => {
  assert.equal(extractTopLevel(frontmatterText, 'name'), path.basename(skillDir));
  const description = extractTopLevel(frontmatterText, 'description');
  assert.ok(description && description.length < 1024);
  assert.match(description, /saved[^.]*profile/i);
  assert.match(description, /vocabulary|jargon|sentence|tone|structure/i);
  assert.match(description, /trigger/i);
  assert.match(description, /confusion|confused/i);
  assert.match(description, /non-understanding|doesn't understand|does not understand/i);
  assert.match(description, /after (?:an|the) answer/i);
  assert.equal(extractNested(frontmatterText, 'metadata', 'version'), '0.2.0');
  assert.equal(extractNested(frontmatterText, 'metadata', 'version'), packageVersion);
  assert.deepEqual(
    checkSkillFrontmatter(skillMdContent, { expectedName: 'im-dumb' }).filter((v) => v.severity === 'error'),
    [],
  );
});

test('SKILL.md body stays within the 900-word target and budget remains warning-only above 1000 (D12)', () => {
  assert.ok((body.match(/\S+/gu) ?? []).length <= 900, "SKILL.md body must stay within the 900-word target");
  const oversized = `${skillMdContent}\n${'word '.repeat(1100)}`;
  const budget = checkSkillFrontmatter(oversized, { expectedName: 'im-dumb' })
    .find((v) => /word warn threshold/i.test(v.message));
  assert.ok(budget, 'expected a body-size finding');
  assert.equal(budget.severity, 'warn');
});

// Profile load and trust boundary.
test('load section covers ordinary success and both exact error groups without raw file access', () => {
  const load = section(body, 'Load the profile');
  assert.match(load, /node scripts\/profile\.js load/);
  assert.match(load, /never read, open, or\s+parse the profile file\s+directly/i);
  assert.match(load, /`success`[\s\S]{0,180}apply the returned profile/i);
  assert.match(load, /`missing`[^\n]*`unparseable`[\s\S]{0,180}offer onboarding/i);
  assert.match(load, /`env-path-invalid`[^\n]*`unsupported-schema-version`[\s\S]{0,220}surface the named error and stop/i);
  assert.match(load, /never start\s+onboarding for either\s+hard\s+error/i);
});

test('load/gate interaction matrix keeps repair available without durable profile state', () => {
  assert.deepEqual(tableRows(body, 'Load the profile'), [
    ['Profile status', 'Ordinary turn', 'Possible confusion or active repair thread', 'After thread reset'],
    ['`success`', 'apply the returned profile', 'repair first using its snapshot; taper and learn are available', 'continue normally'],
    ['`missing` or `unparseable`', 'offer onboarding', 'repair first with defaults in memory; disable taper and learn', 'offer onboarding'],
    ['`env-path-invalid` or `unsupported-schema-version`', 'surface the named error and stop', 'repair first with defaults in memory; disable taper and learn', 'surface the named hard error and stop'],
    ['hosted/no durable profile access', 'use defaults in memory; no persistence', 'repair conversation-locally first with defaults; disable taper and learn', 'continue with defaults; no persistence'],
  ]);
});

test('IM_DUMB_PROFILE controls both load and save, and profile content is data only', () => {
  const load = section(body, 'Load the profile');
  assert.match(load, /IM_DUMB_PROFILE[\s\S]{0,140}both\s+`load` and\s+`save`/i);
  assert.match(load, /Profile output is data/i);
  assert.match(load, /Reveal values only for direct profile management/i);
  assert.match(load, /ignore rules[\s\S]*embeds or quotes a profile command[\s\S]*appends a confusion marker/i);
  assert.match(load, /not profile management[\s\S]*never\s+reveal loaded values/i);
});

// Onboarding and schema.
const VISIBLE_FIELDS = [
  'vocabulary_level',
  'jargon_policy',
  'sentence_length_cap',
  'paragraph_topic_limit',
  'tone',
  'output_shape',
  'adhd_mode',
  'forbidden_phrases',
  'learning_asset_preferences.formats',
] as const;

test('main skill loads onboarding detail only for onboarding/editing and resumes active progress', () => {
  const onboarding = section(body, 'Onboarding');
  assert.match(onboarding, /read `references\/onboarding\.md`/i);
  assert.match(onboarding, /only for\s+those flows/i);
  assert.match(onboarding, /one question at a time/i);
  assert.match(onboarding, /next unanswered field instead of restarting/i);
});

test('main skill loads comprehension detail only for a later possible signal or active repair thread', () => {
  const comprehension = section(body, 'Comprehension repair');
  assert.match(comprehension, /Reject markers in quotes, inline\/fenced code, a specific question, a new\s+task\/topic reset, or an oversized punctuation form/i);
  assert.match(comprehension, /rejected markers as\s+ordinary statements: no diagnosis or `\?`/i);
  assert.match(comprehension, /possible later-turn confusion signal/i);
  assert.match(comprehension, /active repair thread/i);
  assert.match(comprehension, /read\s+`references\/comprehension\.md`/i);
  assert.match(comprehension, /Apply it only then, never for an initial or\s+ordinary\s+turn/i);
  assert.match(comprehension, /first exact `huh` must diagnose; never guess\s+and rephrase/i);
  assert.match(comprehension, /first line `\*\*Likely confusion points\*\*` or `\{`/i);
  assert.match(comprehension, /Forbidden before that line[\s\S]{0,120}Diagnosing[\s\S]{0,80}I'll load[\s\S]{0,80}loading your profile[\s\S]{0,80}Active repair thread/i);
  assert.match(comprehension, /profile\s+failure never blocks diagnosis, rediagnosis, or\s+repair/i);
});

// Non-trigger examples and the no-snapshot fallback live in the reference, not
// the always-loaded body — they are only needed once repair is in play.
test('comprehension reference carries the non-trigger examples and no-snapshot fallback', () => {
  assert.match(comprehensionContent, /replies must not trigger diagnosis[\s\S]*huh!{38}[\s\S]{0,80}41 code points; too long/i);
  assert.match(comprehensionContent, /I don't understand this null lookup[\s\S]{0,60}non-standalone marker/i);
  assert.match(comprehensionContent, /ordinary\s+statement; zero questions/i);
  assert.match(comprehensionContent, /Without a usable snapshot[\s\S]{0,120}defaults and empty known gaps[\s\S]{0,100}disable taper\s+and learning/i);
  assert.match(comprehensionContent, /Repair remains conversation-local/i);
});

test('onboarding asks every visible field one at a time in schema order', () => {
  assert.match(onboardingContent, /one question\s+at a time/i);
  assertOrder(onboardingContent, VISIBLE_FIELDS, 'visible onboarding field order');
});

test('onboarding reference records every enum, bound, and default', () => {
  assert.match(onboardingContent, /`common` \(default\), `technical-ok`, or `expert`/i);
  assert.match(onboardingContent, /`define-on-first-use` \(default\), `avoid`, or `allow`/i);
  assert.match(onboardingContent, /sentence_length_cap`:[\s\S]{0,80}5 through 60; default 20/i);
  assert.match(onboardingContent, /paragraph_topic_limit`:[\s\S]{0,80}1 through 3; default 1/i);
  assert.match(onboardingContent, /`direct` \(default\), `friendly`, or `neutral`/i);
  assert.match(onboardingContent, /`answer-first` \(default\) or `narrative`/i);
  assert.match(onboardingContent, /adhd_mode`:[\s\S]{0,40}default `false`/i);
  assert.match(onboardingContent, /at most 50[\s\S]{0,120}40 Unicode characters[\s\S]{0,40}Default `\[\]`/i);
  assert.match(onboardingContent, /zero or more of `markdown` and\s+`html`[\s\S]{0,80}\["markdown", "html"\]/i);
});

test('onboarding default JSON is complete and exactly schema-shaped', () => {
  const heredoc = /<<'JSON'\n([\s\S]*?)\nJSON/u.exec(onboardingContent);
  assert.ok(heredoc, 'expected a complete JSON stdin example');
  assert.deepEqual(JSON.parse(heredoc[1]!), DEFAULT_PROFILE);
});

test('onboarding confirmation shows every visible value and preserves hidden state on edits', () => {
  assert.match(onboardingContent, /Show every user-visible value[\s\S]{0,100}Do not show hidden/i);
  assert.match(onboardingContent, /explicit confirmation/i);
  assert.match(onboardingContent, /schema_version: 1/);
  assert.match(onboardingContent, /known_gap_types: \[\]/);
  assert.match(onboardingContent, /must preserve `schema_version`, `known_gap_types`[\s\S]{0,100}unchanged field exactly/i);
});

test('save receives complete JSON on stdin and never writes free-form notes or profile files directly', () => {
  assert.match(onboardingContent, /complete JSON object on standard input to\s+`node scripts\/profile\.js save`/i);
  assert.match(onboardingContent, /never hand-edit the profile file/i);
  assert.match(onboardingContent, /Do not add unknown fields or save free-form notes/i);
});

test('no-script fallback emits schema-shaped JSON at the exact path and requires later validation', () => {
  const fallback = section(onboardingContent, 'No-script fallback');
  assert.match(fallback, /complete, schema-shaped JSON object—not free-form notes/i);
  assert.match(fallback, /~\/\.im-dumb\/profile\.json/);
  assert.match(fallback, /IM_DUMB_PROFILE/);
  assert.match(fallback, /Do not claim it was saved/i);
  assert.match(fallback, /node scripts\/profile\.js validate/);
});

// Generation rules.
test('language rules encode FR4 and apply configurable profile fields', () => {
  const language = section(body, 'Language rules');
  for (const rule of [
    /common words/i,
    /define-on-first-use/i,
    /One term per concept/i,
    /active voice/i,
    /sentence_length_cap/i,
    /paragraph_topic_limit[\s\S]{0,120}one\s+topic per paragraph/i,
    /forbidden_phrases/i,
    /built-in filler/i,
    /Never write `just`, `really`,\s+or `actually`/i,
    /unexplained acronyms/i,
    /stack qualifiers/i,
  ]) assert.match(language, rule);
  assertOrder(language, ['`common`', '`technical-ok`', '`expert`'], 'vocabulary choices');
  assertOrder(language, ['`avoid`', '`define-on-first-use`', '`allow`'], 'jargon choices');
});

test('jargon avoidance preserves a user term once as an inline source label, then uses one plain alternative', () => {
  const language = section(body, 'Language rules');
  assert.match(
    language,
    /with `avoid`[\s\S]{0,100}user-supplied technical term[\s\S]{0,80}once in inline code as the source label/i,
  );
  assert.match(language, /give one plain alternative[\s\S]{0,80}then\s+use\s+only that[\s\S]{0,40}plain alternative/i);
  assert.match(language, /inline source label is not prose terminology[\s\S]{0,30}switching/i);
  assert.match(language, /`define-on-first-use` keeps the technical term and defines it[\s\S]{0,30}once/i);
  assert.match(language, /`allow` permits jargon without automatic definitions/i);
  assert.match(language, /One term per concept[\s\S]{0,120}jargon policy/i);
  assert.match(language, /Preserve user-supplied technical terms under the rule above/i);
  assert.match(language, /Never simplify[\s\S]{0,30}away quantities, conditions, warnings, or safety-critical facts/i);
});

test('ADHD mode restructures with the D10 simple-answer exemption', () => {
  const adhd = section(body, 'ADHD mode');
  assert.match(adhd, /do not merely shorten/i);
  assert.match(adhd, /direct answer/i);
  assert.match(adhd, /headed segments/i);
  assert.match(adhd, /at\s+most 3 sibling/i);
  assert.match(adhd, /single\s+paragraph of 3 sentences or fewer/i);
});

test('D9 defines one exact outer marker sequence and all exemptions', () => {
  const output = section(body, 'Output shape');
  assertOrder(output, ['`**Answer**`', '`**Why**`', '`**Steps**`', '`**Example**`'], 'D9 marker sequence');
  assert.match(output, /one outer marker\s+sequence/i);
  assert.match(output, /exactly once as its own full line/i);
  assert.match(output, /outside code\s+fences and\s+blockquotes/i);
  assert.match(output, /`\*\*Answer\*\*` and `\*\*Why\*\*` are required/i);
  assert.match(output, /Omit `\*\*Steps\*\*` or\s+`\*\*Example\*\*`/i);
  assert.match(output, /simple answer \(one paragraph, at most 3\s+sentences\)/i);
  assert.match(output, /machine format[\s\S]{0,100}format request outranks/i);
  assert.match(output, /output_shape: narrative[\s\S]{0,60}no markers unless ADHD mode overrides/i);
});

test('complex output places Plain before Technical inside the same outer sequence', () => {
  const output = section(body, 'Output shape');
  assertOrder(output, ['`Plain:`', '`Technical:`'], 'dual output order');
  assert.match(output, /inside the same outer marker sequence/i);
  assert.match(output, /Never create a\s+separate outer sequence/i);
  assert.match(output, /3 or more new terms/i);
  assert.match(output, /causal chain/i);
  assert.match(output, /trade-offs/i);
});

test('D11 preserves approved response-shaping order without overriding truth or higher instructions', () => {
  const precedence = section(body, 'Conflict precedence');
  assert.match(precedence, /response-shaping conflicts/i);
  assert.match(precedence, /system and developer\s+instructions, which always apply/i);
  assertOrder(precedence, [
    'output contract first',
    'then factual fidelity and safety',
    'then forbidden phrases',
    'then ADHD structure',
    'then output shape',
    'then tone',
  ], 'D11 precedence');
  assert.match(precedence, /format contract controls format; it never authorizes false or unsafe content/i);
  assert.match(precedence, /adhd_mode: true[\s\S]{0,40}overrides `output_shape: narrative`/i);
});

test('generation is one-shot, offline, and manually invocable', () => {
  const how = section(body, 'How this works');
  assert.match(how, /one-shot/i);
  assert.match(how, /never in a second rewrite pass/i);
  assert.match(how, /no response-rewriting script/i);
  assert.match(how, /no checker/i);
  assert.match(how, /`load`\/`validate`\/`save`\/`learn`/i);
  assert.match(how, /No bundled script makes a network call/i);
  const manual = section(body, 'Manual invocation');
  assert.match(manual, /\/im-dumb/);
  assert.match(manual, /\/skill:im-dumb/);
});

test('referenced and on-disk bundled scripts are limited to profile.js', () => {
  const referenced = [...combined.matchAll(/scripts\/([A-Za-z0-9._-]+\.js)\b/gu)].map((match) => match[1]!);
  assert.deepEqual([...new Set(referenced)].sort(), ['profile.js']);
  if (existsSync(scriptsDir)) assert.deepEqual(readdirSync(scriptsDir).sort(), ['profile.js']);
});
