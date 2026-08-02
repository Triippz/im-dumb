import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  checkSentenceCap,
  checkForbiddenPhrases,
  checkOneTermOneConcept,
  checkOutputShapeMarkers,
  checkAdhdStructure,
  checkSkillFrontmatter,
  type Violation,
} from './checkers.ts';
import { DEFAULT_PROFILE, validate, type Profile } from './profile.ts';

// ---------------------------------------------------------------------------
// Step 4, checker CLI. Minimal contract:
//   input:  --file <path> or stdin
//   flags:  --profile <path>, --skill-doc, --json
//   output: stdout = human text, or JSON with --json (machine-safe, one line)
//   exit:   0 no error-severity violations (warn-only or none) | 1 any error
//           severity violation | 2 bad invocation
// ---------------------------------------------------------------------------

const SKILL_NAME = 'im-dumb';

export interface ParsedArgs {
  file?: string;
  profile?: string;
  skillDoc: boolean;
  json: boolean;
}

export type ParseResult = { ok: true; args: ParsedArgs } | { ok: false; message: string };

export function parseArgs(argv: string[]): ParseResult {
  const args: ParsedArgs = { skillDoc: false, json: false };
  let i = 0;
  while (i < argv.length) {
    const token = argv[i]!;
    if (token === '--file' || token === '--profile') {
      const value = argv[i + 1];
      if (value === undefined) {
        return { ok: false, message: `${token} requires a path argument` };
      }
      if (token === '--file') args.file = value;
      else args.profile = value;
      i += 2;
      continue;
    }
    if (token === '--skill-doc') {
      args.skillDoc = true;
      i += 1;
      continue;
    }
    if (token === '--json') {
      args.json = true;
      i += 1;
      continue;
    }
    return { ok: false, message: `unrecognized argument: ${token}` };
  }
  return { ok: true, args };
}

type ReadTextResult = { ok: true; text: string } | { ok: false; message: string };

function readInputText(args: ParsedArgs): ReadTextResult {
  if (args.file !== undefined) {
    try {
      return { ok: true, text: readFileSync(args.file, 'utf8') };
    } catch {
      return { ok: false, message: `cannot read --file: ${args.file}` };
    }
  }
  try {
    return { ok: true, text: readFileSync(0, 'utf8') };
  } catch {
    return { ok: false, message: 'failed to read text from stdin' };
  }
}

type ReadProfileResult = { ok: true; profile: Profile; warnings: string[] } | { ok: false; message: string };

function readProfileArg(profilePath: string | undefined): ReadProfileResult {
  if (profilePath === undefined) {
    return { ok: true, profile: DEFAULT_PROFILE, warnings: [] };
  }
  let raw: string;
  try {
    raw = readFileSync(profilePath, 'utf8');
  } catch {
    return { ok: false, message: `cannot read --profile: ${profilePath}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: `--profile file is not valid JSON: ${profilePath}` };
  }
  const { profile, warnings, errors, unsupportedSchemaVersion } = validate(parsed, 'load');
  if (unsupportedSchemaVersion) {
    return { ok: false, message: `--profile file has an unsupported schema_version: ${profilePath}` };
  }
  if (errors.length > 0) {
    return { ok: false, message: `--profile file is invalid (${errors.join('; ')}): ${profilePath}` };
  }
  return { ok: true, profile, warnings };
}

// structural frontmatter errors always block; language-checker errors
// downgrade to warn in --skill-doc mode (mention-vs-use), never the reverse.
export function runChecks(text: string, profile: Profile, skillDoc: boolean): Violation[] {
  const languageViolations: Violation[] = [
    ...checkSentenceCap(text, profile),
    ...checkForbiddenPhrases(text, profile),
    ...checkOneTermOneConcept(text),
    ...checkOutputShapeMarkers(text, profile),
    ...checkAdhdStructure(text, profile),
  ];

  if (!skillDoc) {
    return languageViolations;
  }

  const structural = checkSkillFrontmatter(text, { expectedName: SKILL_NAME });
  const downgraded = languageViolations.map((v) => (v.severity === 'error' ? { ...v, severity: 'warn' as const } : v));
  return [...structural, ...downgraded];
}

function countSeverities(violations: Violation[]): { errorCount: number; warnCount: number } {
  const errorCount = violations.filter((v) => v.severity === 'error').length;
  return { errorCount, warnCount: violations.length - errorCount };
}

export function formatJson(violations: Violation[]): string {
  const { errorCount, warnCount } = countSeverities(violations);
  return `${JSON.stringify({ violations, errorCount, warnCount })}\n`;
}

export function formatHuman(violations: Violation[]): string {
  if (violations.length === 0) return 'no violations\n';
  const { errorCount, warnCount } = countSeverities(violations);
  const lines = violations.map((v) => `${v.severity}: [${v.checker}] ${v.message}`);
  lines.push(`${errorCount} error(s), ${warnCount} warning(s)`);
  return `${lines.join('\n')}\n`;
}

export function run(argv: string[]): number {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`usage error: ${parsed.message}\n`);
    return 2;
  }
  const { args } = parsed;

  const inputResult = readInputText(args);
  if (!inputResult.ok) {
    process.stderr.write(`usage error: ${inputResult.message}\n`);
    return 2;
  }

  const profileResult = readProfileArg(args.profile);
  if (!profileResult.ok) {
    process.stderr.write(`usage error: ${profileResult.message}\n`);
    return 2;
  }
  for (const warning of profileResult.warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }

  const violations = runChecks(inputResult.text, profileResult.profile, args.skillDoc);
  process.stdout.write(args.json ? formatJson(violations) : formatHuman(violations));

  return violations.some((v) => v.severity === 'error') ? 1 : 0;
}

function main(): void {
  process.exitCode = run(process.argv.slice(2));
}

function isDirectExecution(argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

if (isDirectExecution(process.argv[1])) {
  main();
}
