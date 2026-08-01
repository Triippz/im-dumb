import { readFileSync } from 'node:fs';

export const SMOKE_MANIFEST_VERSION = 1;
export const SMOKE_QUARANTINE_VERSION = 1;

export interface SmokeManifest {
  version: number;
  caseIds: string[];
}

export interface SmokeQuarantine {
  version: number;
  caseIds: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCaseIds(raw: unknown, source: string): string[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${source}: "case_ids" must be an array`);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new Error(`${source}: case ids must be non-empty strings`);
    }
    if (seen.has(entry)) {
      throw new Error(`${source}: duplicate case id "${entry}"`);
    }
    seen.add(entry);
    ids.push(entry);
  }
  return ids.sort();
}

export function parseSmokeManifest(raw: unknown): SmokeManifest {
  if (!isPlainObject(raw)) {
    throw new Error('smoke-manifest: must be an object');
  }
  const allowed = new Set(['version', 'case_ids', 'description']);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new Error(`smoke-manifest: unknown field "${key}"`);
    }
  }
  if (raw.version !== SMOKE_MANIFEST_VERSION) {
    throw new Error(`smoke-manifest: "version" must be ${SMOKE_MANIFEST_VERSION}`);
  }
  if (typeof raw.description !== 'undefined' && typeof raw.description !== 'string') {
    throw new Error('smoke-manifest: "description" must be a string when present');
  }
  const caseIds = parseCaseIds(raw.case_ids, 'smoke-manifest');
  if (caseIds.length === 0) {
    throw new Error('smoke-manifest: "case_ids" must be a non-empty array');
  }
  return { version: SMOKE_MANIFEST_VERSION, caseIds };
}

export function parseSmokeQuarantine(raw: unknown): SmokeQuarantine {
  if (!isPlainObject(raw)) {
    throw new Error('smoke-quarantine: must be an object');
  }
  const allowed = new Set(['version', 'case_ids', 'notes']);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new Error(`smoke-quarantine: unknown field "${key}"`);
    }
  }
  if (raw.version !== SMOKE_QUARANTINE_VERSION) {
    throw new Error(`smoke-quarantine: "version" must be ${SMOKE_QUARANTINE_VERSION}`);
  }
  if (typeof raw.notes !== 'undefined' && !isPlainObject(raw.notes)) {
    throw new Error('smoke-quarantine: "notes" must be an object when present');
  }
  if (!Array.isArray(raw.case_ids)) {
    throw new Error('smoke-quarantine: "case_ids" must be an array');
  }
  const caseIds = parseCaseIds(raw.case_ids, 'smoke-quarantine');
  return { version: SMOKE_QUARANTINE_VERSION, caseIds };
}

export function validateSmokeCaseIds(caseIds: readonly string[], knownIds: readonly string[]): string[] {
  const known = new Set(knownIds);
  return caseIds.filter((id) => !known.has(id));
}

export function resolveBlockingCaseIds(
  manifestCaseIds: readonly string[],
  quarantineCaseIds: readonly string[],
): string[] {
  const quarantined = new Set(quarantineCaseIds);
  return manifestCaseIds.filter((id) => !quarantined.has(id));
}

export function loadSmokeManifest(filePath: string): SmokeManifest {
  return parseSmokeManifest(JSON.parse(readFileSync(filePath, 'utf8')) as unknown);
}

export function loadSmokeQuarantine(filePath: string): SmokeQuarantine {
  return parseSmokeQuarantine(JSON.parse(readFileSync(filePath, 'utf8')) as unknown);
}
