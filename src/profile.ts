import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Types (prd.md / m1-profile-and-language-rules.md §3 — profile schema v1)
// ---------------------------------------------------------------------------

export type VocabularyLevel = 'common' | 'technical-ok' | 'expert';
export type JargonPolicy = 'define-on-first-use' | 'avoid' | 'allow';
export type Tone = 'direct' | 'friendly' | 'neutral';
export type OutputShape = 'answer-first' | 'narrative';
export type LearningAssetFormat = 'markdown' | 'html';

export interface KnownGap {
  type: string;
  confidence: number;
}

export interface LearningAssetPreferences {
  formats: LearningAssetFormat[];
}

export interface Profile {
  schema_version: number;
  vocabulary_level: VocabularyLevel;
  jargon_policy: JargonPolicy;
  sentence_length_cap: number;
  paragraph_topic_limit: number;
  tone: Tone;
  output_shape: OutputShape;
  adhd_mode: boolean;
  known_gap_types: KnownGap[];
  forbidden_phrases: string[];
  learning_asset_preferences: LearningAssetPreferences;
}

export type ValidationMode = 'load' | 'save';

export interface ValidateOutcome {
  profile: Profile;
  warnings: string[];
  errors: string[];
  unsupportedSchemaVersion: boolean;
}

export type LoadOutcome =
  | { ok: true; profile: Profile; warnings: string[] }
  | { ok: false; error: 'missing' | 'unparseable' | 'env-path-invalid' | 'unsupported-schema-version' };

export type SaveOutcome =
  | { ok: true; profile: Profile; warnings: string[] }
  | { ok: false; error: 'env-path-invalid' }
  | { ok: false; error: 'invalid'; reasons: string[] };

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const CURRENT_SCHEMA_VERSION = 1;

export const DEFAULT_PROFILE: Profile = {
  schema_version: CURRENT_SCHEMA_VERSION,
  vocabulary_level: 'common',
  jargon_policy: 'define-on-first-use',
  sentence_length_cap: 20,
  paragraph_topic_limit: 1,
  tone: 'direct',
  output_shape: 'answer-first',
  adhd_mode: false,
  known_gap_types: [],
  forbidden_phrases: [],
  learning_asset_preferences: { formats: ['markdown', 'html'] },
};
Object.freeze(DEFAULT_PROFILE.known_gap_types);
Object.freeze(DEFAULT_PROFILE.forbidden_phrases);
Object.freeze(DEFAULT_PROFILE.learning_asset_preferences.formats);
Object.freeze(DEFAULT_PROFILE.learning_asset_preferences);
Object.freeze(DEFAULT_PROFILE);

const VOCABULARY_LEVELS: readonly VocabularyLevel[] = ['common', 'technical-ok', 'expert'];
const JARGON_POLICIES: readonly JargonPolicy[] = ['define-on-first-use', 'avoid', 'allow'];
const TONES: readonly Tone[] = ['direct', 'friendly', 'neutral'];
const OUTPUT_SHAPES: readonly OutputShape[] = ['answer-first', 'narrative'];
const LEARNING_ASSET_FORMATS: readonly LearningAssetFormat[] = ['markdown', 'html'];

const KNOWN_KEYS: readonly string[] = [
  'schema_version',
  'vocabulary_level',
  'jargon_policy',
  'sentence_length_cap',
  'paragraph_topic_limit',
  'tone',
  'output_shape',
  'adhd_mode',
  'known_gap_types',
  'forbidden_phrases',
  'learning_asset_preferences',
];

// Printable and newline-free per the profile string policy.
const NON_PRINTABLE_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function isCleanString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && [...value].length <= maxLength && !NON_PRINTABLE_RE.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Field validators — each returns the value to use, pushing a warning (load)
// or an error (save) when the supplied value is present but invalid. A
// *missing* field always warns and defaults, in both modes (FR3).
// ---------------------------------------------------------------------------

// Shared branch for every field validator below: missing -> warn+default (both
// modes); valid -> normalized value; invalid-but-present -> error (save) or
// warn+default (load). `normalize` defaults to identity and copies arrays or
// nested objects before returning them to callers.
function readBounded<T>(
  obj: Record<string, unknown>,
  key: string,
  isValid: (value: unknown) => value is T,
  def: T,
  expected: string,
  mode: ValidationMode,
  warnings: string[],
  errors: string[],
  normalize: (value: T) => T = (value) => value,
): T {
  const value = obj[key];
  if (value === undefined) {
    warnings.push(`missing field "${key}", using default ${JSON.stringify(def)}`);
    return def;
  }
  if (isValid(value)) {
    return normalize(value);
  }
  const message = `invalid value for "${key}": ${JSON.stringify(value)} (expected ${expected})`;
  if (mode === 'save') {
    errors.push(message);
    return def;
  }
  warnings.push(`${message}, using default ${JSON.stringify(def)}`);
  return def;
}

function readEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  def: T,
  mode: ValidationMode,
  warnings: string[],
  errors: string[],
): T {
  return readBounded(
    obj,
    key,
    (value): value is T => typeof value === 'string' && (allowed as readonly string[]).includes(value),
    def,
    `one of ${allowed.join(', ')}`,
    mode,
    warnings,
    errors,
  );
}

function readIntInRange(
  obj: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  def: number,
  mode: ValidationMode,
  warnings: string[],
  errors: string[],
): number {
  return readBounded(
    obj,
    key,
    (value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max,
    def,
    `integer ${min}-${max}`,
    mode,
    warnings,
    errors,
  );
}

function readBool(
  obj: Record<string, unknown>,
  key: string,
  def: boolean,
  mode: ValidationMode,
  warnings: string[],
  errors: string[],
): boolean {
  return readBounded(obj, key, (value): value is boolean => typeof value === 'boolean', def, 'boolean', mode, warnings, errors);
}

function readForbiddenPhrases(
  obj: Record<string, unknown>,
  key: string,
  mode: ValidationMode,
  warnings: string[],
  errors: string[],
): string[] {
  return readBounded(
    obj,
    key,
    (value): value is string[] => Array.isArray(value) && value.length <= 50 && value.every((v) => isCleanString(v, 40)),
    [],
    'array of <=50 strings, each <=40 clean chars',
    mode,
    warnings,
    errors,
    (value) => [...value],
  );
}

function readKnownGapTypes(
  obj: Record<string, unknown>,
  key: string,
  mode: ValidationMode,
  warnings: string[],
  errors: string[],
): KnownGap[] {
  const value = readBounded(
    obj,
    key,
    (candidate): candidate is KnownGap[] =>
      Array.isArray(candidate) &&
      candidate.every(
        (item) =>
          isPlainObject(item) &&
          isCleanString(item.type, 40) &&
          typeof item.confidence === 'number' &&
          item.confidence >= 0 &&
          item.confidence <= 1,
      ),
    [],
    'array of {type: string <=40 clean chars, confidence: 0-1}',
    mode,
    warnings,
    errors,
  );

  return value.map((item, index) => {
    for (const nestedKey of Object.keys(item)) {
      if (nestedKey !== 'type' && nestedKey !== 'confidence') {
        const message = `unknown field "${key}[${index}].${nestedKey}"`;
        if (mode === 'save') errors.push(message);
        else warnings.push(`${message}, ignoring`);
      }
    }
    return { type: item.type, confidence: item.confidence };
  });
}

function readLearningAssetPreferences(
  obj: Record<string, unknown>,
  key: string,
  mode: ValidationMode,
  warnings: string[],
  errors: string[],
): LearningAssetPreferences {
  const def: LearningAssetPreferences = { formats: [...DEFAULT_PROFILE.learning_asset_preferences.formats] };
  const value = readBounded(
    obj,
    key,
    (candidate): candidate is LearningAssetPreferences =>
      isPlainObject(candidate) &&
      Array.isArray(candidate.formats) &&
      candidate.formats.every(
        (format) => typeof format === 'string' && (LEARNING_ASSET_FORMATS as readonly string[]).includes(format),
      ),
    def,
    '{formats: (markdown|html)[]}',
    mode,
    warnings,
    errors,
    (candidate) => ({ formats: [...candidate.formats] }),
  );

  if (isPlainObject(obj[key])) {
    for (const nestedKey of Object.keys(obj[key])) {
      if (nestedKey !== 'formats') {
        const message = `unknown field "${key}.${nestedKey}"`;
        if (mode === 'save') errors.push(message);
        else warnings.push(`${message}, ignoring`);
      }
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// validate() — single entry point for both lenient load-time and strict
// save-time validation (D15).
// ---------------------------------------------------------------------------

export function validate(raw: unknown, mode: ValidationMode): ValidateOutcome {
  const warnings: string[] = [];
  const errors: string[] = [];
  let unsupportedSchemaVersion = false;

  let obj: Record<string, unknown>;
  if (isPlainObject(raw)) {
    obj = raw;
  } else {
    obj = {};
    if (mode === 'save') {
      errors.push('profile data is not an object');
    } else {
      warnings.push('profile data is not an object; using defaults');
    }
  }

  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.includes(key)) {
      if (mode === 'save') {
        errors.push(`unknown field ${JSON.stringify(key)}`);
      } else {
        warnings.push(`unknown field ${JSON.stringify(key)}, ignoring`);
      }
    }
  }

  const rawVersion = obj.schema_version;
  let schema_version: number = DEFAULT_PROFILE.schema_version;
  if (rawVersion === undefined) {
    warnings.push(`missing field "schema_version", using default ${DEFAULT_PROFILE.schema_version}`);
  } else if (typeof rawVersion === 'number' && Number.isInteger(rawVersion) && rawVersion === CURRENT_SCHEMA_VERSION) {
    schema_version = rawVersion;
  } else if (typeof rawVersion === 'number' && Number.isInteger(rawVersion) && rawVersion > CURRENT_SCHEMA_VERSION) {
    unsupportedSchemaVersion = true;
    errors.push(
      `invalid value for "schema_version": ${JSON.stringify(rawVersion)} (unsupported-schema-version, must be <= ${CURRENT_SCHEMA_VERSION})`,
    );
  } else {
    warnings.push(`invalid field "schema_version": ${JSON.stringify(rawVersion)}, using default ${DEFAULT_PROFILE.schema_version}`);
  }

  const profile: Profile = {
    schema_version,
    vocabulary_level: readEnum(obj, 'vocabulary_level', VOCABULARY_LEVELS, DEFAULT_PROFILE.vocabulary_level, mode, warnings, errors),
    jargon_policy: readEnum(obj, 'jargon_policy', JARGON_POLICIES, DEFAULT_PROFILE.jargon_policy, mode, warnings, errors),
    sentence_length_cap: readIntInRange(obj, 'sentence_length_cap', 5, 60, DEFAULT_PROFILE.sentence_length_cap, mode, warnings, errors),
    paragraph_topic_limit: readIntInRange(obj, 'paragraph_topic_limit', 1, 3, DEFAULT_PROFILE.paragraph_topic_limit, mode, warnings, errors),
    tone: readEnum(obj, 'tone', TONES, DEFAULT_PROFILE.tone, mode, warnings, errors),
    output_shape: readEnum(obj, 'output_shape', OUTPUT_SHAPES, DEFAULT_PROFILE.output_shape, mode, warnings, errors),
    adhd_mode: readBool(obj, 'adhd_mode', DEFAULT_PROFILE.adhd_mode, mode, warnings, errors),
    known_gap_types: readKnownGapTypes(obj, 'known_gap_types', mode, warnings, errors),
    forbidden_phrases: readForbiddenPhrases(obj, 'forbidden_phrases', mode, warnings, errors),
    learning_asset_preferences: readLearningAssetPreferences(obj, 'learning_asset_preferences', mode, warnings, errors),
  };

  return { profile, warnings, errors, unsupportedSchemaVersion };
}

// ---------------------------------------------------------------------------
// Path resolution (D15 — IM_DUMB_PROFILE is a filesystem path only)
// ---------------------------------------------------------------------------

function resolveProfilePath(): { profilePath: string; fromEnv: boolean } {
  const envPath = process.env.IM_DUMB_PROFILE;
  if (envPath !== undefined) {
    return { profilePath: envPath, fromEnv: true };
  }
  return { profilePath: path.join(homedir(), '.im-dumb', 'profile.json'), fromEnv: false };
}

type ReadProfileFileOutcome =
  | { ok: true; parsed: unknown }
  | { ok: false; error: 'missing' | 'unparseable' | 'env-path-invalid' };

function readProfileFile(): ReadProfileFileOutcome {
  const { profilePath, fromEnv } = resolveProfilePath();
  if (fromEnv && profilePath.trim() === '') {
    return { ok: false, error: 'env-path-invalid' };
  }
  let raw: string;
  try {
    raw = readFileSync(profilePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: false, error: 'missing' };
    }
    return { ok: false, error: 'env-path-invalid' };
  }
  try {
    return { ok: true, parsed: JSON.parse(raw) };
  } catch {
    return { ok: false, error: 'unparseable' };
  }
}

// ---------------------------------------------------------------------------
// load() / save()
// ---------------------------------------------------------------------------

export function load(): LoadOutcome {
  const read = readProfileFile();
  if (!read.ok) {
    return read;
  }
  const { profile, warnings, unsupportedSchemaVersion } = validate(read.parsed, 'load');
  if (unsupportedSchemaVersion) {
    return { ok: false, error: 'unsupported-schema-version' };
  }
  return { ok: true, profile, warnings };
}

export function save(input: unknown): SaveOutcome {
  const { profilePath, fromEnv } = resolveProfilePath();
  if (fromEnv && profilePath.trim() === '') {
    return { ok: false, error: 'env-path-invalid' };
  }

  const { profile, warnings, errors } = validate(input, 'save');
  if (errors.length > 0) {
    return { ok: false, error: 'invalid', reasons: errors };
  }

  const dir = path.dirname(profilePath);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    return { ok: false, error: 'env-path-invalid' };
  }

  const tmpPath = path.join(dir, `.profile.json.${randomUUID()}.tmp`);
  const serialized = `${JSON.stringify(profile, null, 2)}\n`;
  try {
    writeFileSync(tmpPath, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(tmpPath, profilePath);
  } catch {
    try {
      unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup; the write error below is what matters
    }
    return { ok: false, error: 'env-path-invalid' };
  }

  return { ok: true, profile, warnings };
}

// ---------------------------------------------------------------------------
// CLI entry (D15 stream/exit contract): stdout = JSON only, stderr = warnings.
// load  -> exit 0 {profile, warnings} | exit 1 {error}
// validate -> exit 0 {valid: true, profile, warnings} | exit 1 {valid: false, ...}
// save  -> exit 0 {profile, warnings} | exit 1 {error, ...}
// usage error -> exit 2
// ---------------------------------------------------------------------------

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function printWarnings(warnings: string[]): void {
  for (const warning of warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }
}

function runLoad(): number {
  const result = load();
  if (result.ok) {
    printWarnings(result.warnings);
    printJson({ profile: result.profile, warnings: result.warnings });
    return 0;
  }
  printJson({ error: result.error });
  return 1;
}

function runValidate(): number {
  const read = readProfileFile();
  if (!read.ok) {
    printJson({ valid: false, error: read.error });
    return 1;
  }
  const { profile, warnings, errors } = validate(read.parsed, 'save');
  if (errors.length > 0) {
    printJson({ valid: false, error: 'invalid', reasons: errors });
    return 1;
  }
  printWarnings(warnings);
  printJson({ valid: true, profile, warnings });
  return 0;
}

function runSave(): number {
  let raw: string;
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    printJson({ error: 'usage', message: 'failed to read profile JSON from stdin' });
    return 2;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    printJson({ error: 'usage', message: 'stdin is not valid JSON' });
    return 2;
  }
  const result = save(parsed);
  if (result.ok) {
    printWarnings(result.warnings);
    printJson({ profile: result.profile, warnings: result.warnings });
    return 0;
  }
  if (result.error === 'invalid') {
    printJson({ error: 'invalid', reasons: result.reasons });
  } else {
    printJson({ error: result.error });
  }
  return 1;
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  if (command === undefined || rest.length > 0) {
    process.stderr.write('usage: profile.js <load|validate|save>\n');
    process.exitCode = 2;
    return;
  }
  switch (command) {
    case 'load':
      process.exitCode = runLoad();
      return;
    case 'validate':
      process.exitCode = runValidate();
      return;
    case 'save':
      process.exitCode = runSave();
      return;
    default:
      process.stderr.write('usage: profile.js <load|validate|save>\n');
      process.exitCode = 2;
  }
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
