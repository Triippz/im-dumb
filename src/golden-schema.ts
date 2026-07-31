import { createHash } from 'node:crypto';

import { CHECKER_IDS, type CheckerId } from './checkers.ts';

// ---------------------------------------------------------------------------
// D14 — golden case schema (hand-rolled validator, no ajv)
// ---------------------------------------------------------------------------

export const GOLDEN_CATEGORIES = ['persona-baseline', 'jargon-decomposition', 'adhd-pair', 'adversarial'] as const;
export type GoldenCategory = (typeof GOLDEN_CATEGORIES)[number];

export const EXPECTED_RESULTS = ['pass', 'fail', 'warn'] as const;
export type ExpectedResult = (typeof EXPECTED_RESULTS)[number];

export interface ExpectedCheck {
  checker: CheckerId;
  expect: ExpectedResult;
}

export interface GoldenCase {
  id: string;
  category: GoldenCategory;
  prompt: string;
  profile: Record<string, unknown>;
  reference_facts: string[];
  must_preserve: string[];
  expected_checks: ExpectedCheck[];
  pair_id?: string;
}

export interface GoldenValidationResult {
  valid: boolean;
  errors: string[];
}

const MAX_STRING_ARRAY_ITEMS = 20;
const MAX_STRING_ARRAY_ITEM_LENGTH = 200;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateStringArrayField(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`"${field}" must be an array of strings`);
    return;
  }
  if (value.length > MAX_STRING_ARRAY_ITEMS) {
    errors.push(`"${field}" must have at most ${MAX_STRING_ARRAY_ITEMS} items, got ${value.length}`);
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string') {
      errors.push(`"${field}[${index}]" must be a string`);
    } else if (item.length > MAX_STRING_ARRAY_ITEM_LENGTH) {
      errors.push(`"${field}[${index}]" must be at most ${MAX_STRING_ARRAY_ITEM_LENGTH} chars, got ${item.length}`);
    }
  });
}

export function validateGoldenCase(raw: unknown): GoldenValidationResult {
  if (!isPlainObject(raw)) {
    return { valid: false, errors: ['golden case must be an object'] };
  }

  const errors: string[] = [];

  if (typeof raw.id !== 'string' || raw.id.trim() === '') {
    errors.push('"id" must be a non-empty string');
  }

  if (typeof raw.category !== 'string' || !(GOLDEN_CATEGORIES as readonly string[]).includes(raw.category)) {
    errors.push(`"category" must be one of ${GOLDEN_CATEGORIES.join(', ')}`);
  }

  if (typeof raw.prompt !== 'string' || raw.prompt.trim() === '') {
    errors.push('"prompt" must be a non-empty string');
  }

  if (!isPlainObject(raw.profile)) {
    errors.push('"profile" must be an object');
  }

  validateStringArrayField(raw.reference_facts, 'reference_facts', errors);
  validateStringArrayField(raw.must_preserve, 'must_preserve', errors);

  if (!Array.isArray(raw.expected_checks) || raw.expected_checks.length === 0) {
    errors.push('"expected_checks" must be a non-empty array');
  } else {
    raw.expected_checks.forEach((entry, index) => {
      if (!isPlainObject(entry)) {
        errors.push(`"expected_checks[${index}]" must be an object`);
        return;
      }
      if (typeof entry.checker !== 'string' || !(CHECKER_IDS as readonly string[]).includes(entry.checker)) {
        errors.push(`"expected_checks[${index}].checker" must be one of ${CHECKER_IDS.join(', ')}`);
      }
      if (typeof entry.expect !== 'string' || !(EXPECTED_RESULTS as readonly string[]).includes(entry.expect)) {
        errors.push(`"expected_checks[${index}].expect" must be one of ${EXPECTED_RESULTS.join(', ')}`);
      }
    });
  }

  if (raw.pair_id !== undefined && (typeof raw.pair_id !== 'string' || raw.pair_id.trim() === '')) {
    errors.push('"pair_id" must be a non-empty string when present');
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// D14 — pair invariant + case-id uniqueness across a validated set
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

export function validateGoldenCaseSet(cases: GoldenCase[]): GoldenValidationResult {
  const errors: string[] = [];

  const seenIds = new Set<string>();
  for (const c of cases) {
    if (seenIds.has(c.id)) {
      errors.push(`duplicate case id "${c.id}"`);
    }
    seenIds.add(c.id);
  }

  const byPairId = new Map<string, GoldenCase[]>();
  for (const c of cases) {
    if (c.pair_id === undefined) continue;
    const group = byPairId.get(c.pair_id) ?? [];
    group.push(c);
    byPairId.set(c.pair_id, group);
  }

  for (const [pairId, group] of byPairId) {
    if (group.length !== 2) {
      errors.push(`pair_id "${pairId}" must name exactly 2 cases, found ${group.length}`);
      continue;
    }
    const [a, b] = group as [GoldenCase, GoldenCase];
    if (a.prompt !== b.prompt) {
      errors.push(`pair_id "${pairId}" cases must share an identical prompt`);
    }
    const { adhd_mode: adhdA, ...restA } = a.profile;
    const { adhd_mode: adhdB, ...restB } = b.profile;
    if (!deepEqual(restA, restB)) {
      errors.push(`pair_id "${pairId}" cases must share an identical profile except adhd_mode`);
    }
    if (adhdA === adhdB) {
      errors.push(`pair_id "${pairId}" cases must differ on adhd_mode`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// D14 — manifest: sorted case ids + per-file SHA-256, generator + verifier
// ---------------------------------------------------------------------------

export interface GoldenCaseFile {
  id: string;
  path: string;
  contents: string;
}

export interface GoldenManifestEntry {
  id: string;
  path: string;
  sha256: string;
}

export interface GoldenManifest {
  cases: GoldenManifestEntry[];
}

export interface ManifestDriftResult {
  drifted: boolean;
  issues: string[];
}

export function generateManifest(files: GoldenCaseFile[]): GoldenManifest {
  const cases = files
    .map((file) => ({ id: file.id, path: file.path, sha256: createHash('sha256').update(file.contents, 'utf8').digest('hex') }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { cases };
}

export function verifyManifest(manifest: GoldenManifest, files: GoldenCaseFile[]): ManifestDriftResult {
  const issues: string[] = [];
  const current = generateManifest(files);

  const manifestById = new Map(manifest.cases.map((entry) => [entry.id, entry]));
  const currentById = new Map(current.cases.map((entry) => [entry.id, entry]));

  for (const [id, entry] of currentById) {
    const recorded = manifestById.get(id);
    if (!recorded) {
      issues.push(`case "${id}" is present on disk but missing from the manifest`);
    } else if (recorded.sha256 !== entry.sha256) {
      issues.push(`case "${id}" content hash drifted (manifest ${recorded.sha256}, on-disk ${entry.sha256})`);
    } else if (recorded.path !== entry.path) {
      issues.push(`case "${id}" path drifted (manifest ${recorded.path}, on-disk ${entry.path})`);
    }
  }

  for (const id of manifestById.keys()) {
    if (!currentById.has(id)) {
      issues.push(`case "${id}" is recorded in the manifest but missing on disk`);
    }
  }

  return { drifted: issues.length > 0, issues };
}
