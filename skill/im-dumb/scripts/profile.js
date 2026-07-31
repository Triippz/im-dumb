import { linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync, } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
export const CURRENT_SCHEMA_VERSION = 1;
export const DEFAULT_PROFILE = {
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
const VOCABULARY_LEVELS = ['common', 'technical-ok', 'expert'];
const JARGON_POLICIES = ['define-on-first-use', 'avoid', 'allow'];
const TONES = ['direct', 'friendly', 'neutral'];
const OUTPUT_SHAPES = ['answer-first', 'narrative'];
const LEARNING_ASSET_FORMATS = ['markdown', 'html'];
const GAP_TYPES = ['term', 'step', 'assumption', 'framing'];
export const PROFILE_LOCK_SUFFIX = '.lock';
export const PROFILE_LOCK_RETRY_MS = 25;
export const PROFILE_LOCK_TIMEOUT_MS = 500;
export const PROFILE_LOCK_STALE_MS = 30_000;
const KNOWN_KEYS = [
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
function isCleanString(value, maxLength) {
    return typeof value === 'string' && [...value].length <= maxLength && !NON_PRINTABLE_RE.test(value);
}
function isPlainObject(value) {
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
function readBounded(obj, key, isValid, def, expected, mode, warnings, errors, normalize = (value) => value) {
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
function readEnum(obj, key, allowed, def, mode, warnings, errors) {
    return readBounded(obj, key, (value) => typeof value === 'string' && allowed.includes(value), def, `one of ${allowed.join(', ')}`, mode, warnings, errors);
}
function readIntInRange(obj, key, min, max, def, mode, warnings, errors) {
    return readBounded(obj, key, (value) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max, def, `integer ${min}-${max}`, mode, warnings, errors);
}
function readBool(obj, key, def, mode, warnings, errors) {
    return readBounded(obj, key, (value) => typeof value === 'boolean', def, 'boolean', mode, warnings, errors);
}
function readForbiddenPhrases(obj, key, mode, warnings, errors) {
    return readBounded(obj, key, (value) => Array.isArray(value) && value.length <= 50 && value.every((v) => isCleanString(v, 40)), [], 'array of <=50 strings, each <=40 clean chars', mode, warnings, errors, (value) => [...value]);
}
function readKnownGapTypes(obj, key, mode, warnings, errors) {
    const value = readBounded(obj, key, (candidate) => Array.isArray(candidate) &&
        candidate.every((item) => isPlainObject(item) &&
            isCleanString(item.type, 40) &&
            typeof item.confidence === 'number' &&
            item.confidence >= 0 &&
            item.confidence <= 1), [], 'array of {type: string <=40 clean chars, confidence: 0-1}', mode, warnings, errors);
    return value.map((item, index) => {
        for (const nestedKey of Object.keys(item)) {
            if (nestedKey !== 'type' && nestedKey !== 'confidence') {
                const message = `unknown field "${key}[${index}].${nestedKey}"`;
                if (mode === 'save')
                    errors.push(message);
                else
                    warnings.push(`${message}, ignoring`);
            }
        }
        return { type: item.type, confidence: item.confidence };
    });
}
function readLearningAssetPreferences(obj, key, mode, warnings, errors) {
    const def = { formats: [...DEFAULT_PROFILE.learning_asset_preferences.formats] };
    const value = readBounded(obj, key, (candidate) => isPlainObject(candidate) &&
        Array.isArray(candidate.formats) &&
        candidate.formats.every((format) => typeof format === 'string' && LEARNING_ASSET_FORMATS.includes(format)), def, '{formats: (markdown|html)[]}', mode, warnings, errors, (candidate) => ({ formats: [...candidate.formats] }));
    if (isPlainObject(obj[key])) {
        for (const nestedKey of Object.keys(obj[key])) {
            if (nestedKey !== 'formats') {
                const message = `unknown field "${key}.${nestedKey}"`;
                if (mode === 'save')
                    errors.push(message);
                else
                    warnings.push(`${message}, ignoring`);
            }
        }
    }
    return value;
}
// ---------------------------------------------------------------------------
// validate() — single entry point for both lenient load-time and strict
// save-time validation (D15).
// ---------------------------------------------------------------------------
export function validate(raw, mode) {
    const warnings = [];
    const errors = [];
    let unsupportedSchemaVersion = false;
    let obj;
    if (isPlainObject(raw)) {
        obj = raw;
    }
    else {
        obj = {};
        if (mode === 'save') {
            errors.push('profile data is not an object');
        }
        else {
            warnings.push('profile data is not an object; using defaults');
        }
    }
    for (const key of Object.keys(obj)) {
        if (!KNOWN_KEYS.includes(key)) {
            if (mode === 'save') {
                errors.push(`unknown field ${JSON.stringify(key)}`);
            }
            else {
                warnings.push(`unknown field ${JSON.stringify(key)}, ignoring`);
            }
        }
    }
    const rawVersion = obj.schema_version;
    let schema_version = DEFAULT_PROFILE.schema_version;
    if (rawVersion === undefined) {
        warnings.push(`missing field "schema_version", using default ${DEFAULT_PROFILE.schema_version}`);
    }
    else if (typeof rawVersion === 'number' && Number.isInteger(rawVersion) && rawVersion === CURRENT_SCHEMA_VERSION) {
        schema_version = rawVersion;
    }
    else if (typeof rawVersion === 'number' && Number.isInteger(rawVersion) && rawVersion > CURRENT_SCHEMA_VERSION) {
        unsupportedSchemaVersion = true;
        errors.push(`invalid value for "schema_version": ${JSON.stringify(rawVersion)} (unsupported-schema-version, must be <= ${CURRENT_SCHEMA_VERSION})`);
    }
    else {
        warnings.push(`invalid field "schema_version": ${JSON.stringify(rawVersion)}, using default ${DEFAULT_PROFILE.schema_version}`);
    }
    const profile = {
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
function resolveProfilePath() {
    const envPath = process.env.IM_DUMB_PROFILE;
    if (envPath !== undefined) {
        return { profilePath: envPath.trim() === '' ? envPath : path.resolve(envPath), fromEnv: true };
    }
    return { profilePath: path.join(homedir(), '.im-dumb', 'profile.json'), fromEnv: false };
}
function readProfileFile() {
    const { profilePath, fromEnv } = resolveProfilePath();
    if (fromEnv && profilePath.trim() === '') {
        return { ok: false, error: 'env-path-invalid' };
    }
    let raw;
    try {
        raw = readFileSync(profilePath, 'utf8');
    }
    catch (err) {
        const code = err.code;
        if (code === 'ENOENT') {
            return { ok: false, error: 'missing' };
        }
        return { ok: false, error: 'env-path-invalid' };
    }
    try {
        return { ok: true, parsed: JSON.parse(raw) };
    }
    catch {
        return { ok: false, error: 'unparseable' };
    }
}
function sleepSync(milliseconds) {
    if (milliseconds > 0)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
function readLockRecord(lockPath) {
    try {
        const parsed = JSON.parse(readFileSync(lockPath, 'utf8'));
        if (!isPlainObject(parsed) ||
            typeof parsed.token !== 'string' ||
            parsed.token === '' ||
            typeof parsed.pid !== 'number' ||
            !Number.isInteger(parsed.pid) ||
            parsed.pid <= 0 ||
            typeof parsed.createdAt !== 'number' ||
            !Number.isFinite(parsed.createdAt)) {
            return undefined;
        }
        return { token: parsed.token, pid: parsed.pid, createdAt: parsed.createdAt };
    }
    catch {
        return undefined;
    }
}
function sameLockRecord(value, expected) {
    return (value?.token === expected.token &&
        value.pid === expected.pid &&
        value.createdAt === expected.createdAt);
}
function processIsProvenDead(pid) {
    try {
        process.kill(pid, 0);
        return false;
    }
    catch (error) {
        return error.code === 'ESRCH';
    }
}
const PROFILE_RECLAIM_MARKER = '.reclaim.';
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
function fileIdentity(filePath) {
    try {
        const stat = statSync(filePath);
        return { dev: stat.dev, ino: stat.ino };
    }
    catch {
        return undefined;
    }
}
function hasIdentity(filePath, identity) {
    const current = fileIdentity(filePath);
    return current?.dev === identity.dev && current.ino === identity.ino;
}
function isProvenStale(record) {
    return (record !== undefined &&
        Date.now() - record.createdAt > PROFILE_LOCK_STALE_MS &&
        processIsProvenDead(record.pid));
}
function removePathWithIdentity(filePath, identity) {
    if (identity === undefined || !hasIdentity(filePath, identity))
        return;
    try {
        unlinkSync(filePath);
    }
    catch {
        // Best effort; never unlink a replacement path.
    }
}
function createReadyRecord(finalPath, record) {
    const tmpPath = path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${randomUUID()}.tmp`);
    try {
        writeFileSync(tmpPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        try {
            linkSync(tmpPath, finalPath);
            return 'created';
        }
        catch (error) {
            return error.code === 'EEXIST' ? 'exists' : 'error';
        }
    }
    catch {
        return 'error';
    }
    finally {
        try {
            unlinkSync(tmpPath);
        }
        catch {
            // The private unique temp may already be absent.
        }
    }
}
function candidatePath(lockPath, record) {
    return `${lockPath}${PROFILE_RECLAIM_MARKER}${record.createdAt}.${record.pid}.${record.token}`;
}
function candidateLinkPath(candidate) {
    return `${candidate.path}.main-link`;
}
function parseCandidate(lockPath, filename) {
    const prefix = `${path.basename(lockPath)}${PROFILE_RECLAIM_MARKER}`;
    if (!filename.startsWith(prefix))
        return undefined;
    const suffix = filename.slice(prefix.length);
    const match = new RegExp(`^(\\d+)\\.(\\d+)\\.(${UUID_PATTERN})$`, 'u').exec(suffix);
    if (match === null)
        return undefined;
    const createdAt = Number(match[1]);
    const pid = Number(match[2]);
    const token = match[3];
    if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(pid) || pid <= 0)
        return undefined;
    const candidateFile = path.join(path.dirname(lockPath), filename);
    const record = readLockRecord(candidateFile);
    const expected = { token, pid, createdAt };
    const identity = fileIdentity(candidateFile);
    if (!sameLockRecord(record, expected) || identity === undefined)
        return undefined;
    return { path: candidateFile, record: expected, identity };
}
function listCandidates(lockPath, deadline) {
    try {
        const candidates = [];
        for (const filename of readdirSync(path.dirname(lockPath))) {
            if (performance.now() >= deadline)
                break;
            const candidate = parseCandidate(lockPath, filename);
            if (candidate !== undefined)
                candidates.push(candidate);
        }
        return candidates;
    }
    catch {
        return undefined;
    }
}
function removeOwnedCandidate(candidate) {
    removePathWithIdentity(candidateLinkPath(candidate), fileIdentity(candidateLinkPath(candidate)));
    if (sameLockRecord(readLockRecord(candidate.path), candidate.record) &&
        hasIdentity(candidate.path, candidate.identity)) {
        try {
            unlinkSync(candidate.path);
        }
        catch {
            // Best effort; this immutable unique path cannot belong to another owner.
        }
    }
}
function removeStaleCandidate(candidate) {
    const reread = readLockRecord(candidate.path);
    if (!sameLockRecord(reread, candidate.record) ||
        !hasIdentity(candidate.path, candidate.identity) ||
        !isProvenStale(reread)) {
        return false;
    }
    removePathWithIdentity(candidateLinkPath(candidate), fileIdentity(candidateLinkPath(candidate)));
    const immediate = readLockRecord(candidate.path);
    if (!sameLockRecord(immediate, candidate.record) || !hasIdentity(candidate.path, candidate.identity))
        return false;
    try {
        unlinkSync(candidate.path);
        return true;
    }
    catch {
        return false;
    }
}
function activeCandidates(lockPath, deadline) {
    const first = listCandidates(lockPath, deadline);
    if (first === undefined)
        return undefined;
    for (const candidate of first) {
        if (performance.now() >= deadline)
            break;
        if (isProvenStale(candidate.record))
            removeStaleCandidate(candidate);
    }
    return listCandidates(lockPath, deadline);
}
function electedCandidate(candidates) {
    return [...candidates].sort((a, b) => a.record.createdAt - b.record.createdAt ||
        (a.record.token < b.record.token ? -1 : a.record.token > b.record.token ? 1 : 0))[0];
}
function ownsElection(lockPath, own, deadline) {
    const contenders = activeCandidates(lockPath, deadline);
    if (contenders === undefined)
        return false;
    const current = contenders.find((candidate) => candidate.path === own.path);
    const elected = electedCandidate(contenders);
    return (current !== undefined &&
        sameLockRecord(readLockRecord(own.path), own.record) &&
        hasIdentity(own.path, own.identity) &&
        elected?.path === own.path);
}
function tryReclaimProvenStaleLock(lockPath, deadline) {
    if (performance.now() >= deadline)
        return false;
    const first = readLockRecord(lockPath);
    if (!isProvenStale(first))
        return false;
    const record = { token: randomUUID(), pid: process.pid, createdAt: Date.now() };
    const ownPath = candidatePath(lockPath, record);
    if (createReadyRecord(ownPath, record) !== 'created')
        return false;
    const ownIdentity = fileIdentity(ownPath);
    if (ownIdentity === undefined) {
        try {
            unlinkSync(ownPath);
        }
        catch {
            // Best effort for this immutable unique path.
        }
        return false;
    }
    const own = { path: ownPath, record, identity: ownIdentity };
    const linkPath = candidateLinkPath(own);
    let linkIdentity;
    try {
        if (!ownsElection(lockPath, own, deadline))
            return false;
        try {
            linkSync(lockPath, linkPath);
        }
        catch {
            return false;
        }
        linkIdentity = fileIdentity(linkPath);
        const main = readLockRecord(lockPath);
        const linked = readLockRecord(linkPath);
        if (!ownsElection(lockPath, own, deadline) ||
            !sameLockRecord(main, first) ||
            !sameLockRecord(linked, first) ||
            !isProvenStale(main) ||
            !isProvenStale(linked) ||
            linkIdentity === undefined ||
            !hasIdentity(lockPath, linkIdentity) ||
            !hasIdentity(linkPath, linkIdentity)) {
            return false;
        }
        const immediateMain = readLockRecord(lockPath);
        if (performance.now() >= deadline ||
            !ownsElection(lockPath, own, deadline) ||
            !sameLockRecord(immediateMain, first) ||
            !hasIdentity(lockPath, linkIdentity)) {
            return false;
        }
        try {
            unlinkSync(lockPath);
            return true;
        }
        catch {
            return false;
        }
    }
    finally {
        try {
            unlinkSync(linkPath);
        }
        catch {
            // Token-keyed path is private to this reclaimer and may be absent.
        }
        removeOwnedCandidate(own);
    }
}
function acquireProfileLock(profilePath) {
    const lockPath = `${profilePath}${PROFILE_LOCK_SUFFIX}`;
    const token = randomUUID();
    const deadline = performance.now() + PROFILE_LOCK_TIMEOUT_MS;
    while (true) {
        if (performance.now() >= deadline)
            return { ok: false, error: 'lock-timeout' };
        const before = activeCandidates(lockPath, deadline);
        if (before === undefined)
            return { ok: false, error: 'env-path-invalid' };
        if (performance.now() >= deadline)
            return { ok: false, error: 'lock-timeout' };
        if (before.length === 0) {
            const record = { token, pid: process.pid, createdAt: Date.now() };
            const create = createReadyRecord(lockPath, record);
            if (create === 'error')
                return { ok: false, error: 'env-path-invalid' };
            if (create === 'created') {
                // Load-bearing invariant: a reclaimer candidate lives from before its
                // first election check until after main-lock unlink. A candidate that
                // appears after our pre-scan may therefore unlink this fresh lock; the
                // post-scan must release our token instead of entering the writer.
                const after = activeCandidates(lockPath, deadline);
                if (after === undefined) {
                    releaseProfileLock({ token, lockPath });
                    return { ok: false, error: 'env-path-invalid' };
                }
                if (performance.now() >= deadline) {
                    releaseProfileLock({ token, lockPath });
                    return { ok: false, error: 'lock-timeout' };
                }
                if (after.length === 0)
                    return { ok: true, token, lockPath };
                releaseProfileLock({ token, lockPath });
            }
            if (tryReclaimProvenStaleLock(lockPath, deadline)) {
                if (performance.now() >= deadline)
                    return { ok: false, error: 'lock-timeout' };
                continue;
            }
        }
        const remaining = deadline - performance.now();
        if (remaining <= 0)
            return { ok: false, error: 'lock-timeout' };
        sleepSync(Math.min(PROFILE_LOCK_RETRY_MS, remaining));
    }
}
function releaseProfileLock(lock) {
    const record = readLockRecord(lock.lockPath);
    if (record?.token !== lock.token)
        return;
    try {
        unlinkSync(lock.lockPath);
    }
    catch {
        // Best effort. Never remove a lock whose token is not ours.
    }
}
function atomicWriteProfile(profilePath, value) {
    const dir = path.dirname(profilePath);
    const tmpPath = path.join(dir, `.${path.basename(profilePath)}.${randomUUID()}.tmp`);
    try {
        writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        renameSync(tmpPath, profilePath);
        return 'ok';
    }
    catch {
        try {
            unlinkSync(tmpPath);
        }
        catch {
            // Best-effort cleanup; the write failure is what matters.
        }
        return 'env-path-invalid';
    }
}
// ---------------------------------------------------------------------------
// load() / save() / learn()
// ---------------------------------------------------------------------------
export function load() {
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
export function save(input) {
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
    }
    catch {
        return { ok: false, error: 'env-path-invalid' };
    }
    const lock = acquireProfileLock(profilePath);
    if (!lock.ok)
        return lock;
    try {
        const write = atomicWriteProfile(profilePath, profile);
        if (write !== 'ok')
            return { ok: false, error: write };
        return { ok: true, profile, warnings };
    }
    finally {
        releaseProfileLock(lock);
    }
}
function exactKeys(value, allowed) {
    const keys = Object.keys(value);
    return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}
function isConfidence(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
function validateLearnInput(input) {
    if (!isPlainObject(input) || !exactKeys(input, input.decrement === undefined
        ? ['type', 'outcome', 'expectedConfidence']
        : ['type', 'outcome', 'expectedConfidence', 'decrement'])) {
        return false;
    }
    if (typeof input.type !== 'string' ||
        !GAP_TYPES.includes(input.type) ||
        input.outcome !== 'success' ||
        !(input.expectedConfidence === null || isConfidence(input.expectedConfidence))) {
        return false;
    }
    if (input.decrement === undefined)
        return true;
    if (!isPlainObject(input.decrement) ||
        !exactKeys(input.decrement, ['type', 'expectedConfidence', 'by']) ||
        typeof input.decrement.type !== 'string' ||
        !GAP_TYPES.includes(input.decrement.type) ||
        input.decrement.type === input.type ||
        !isConfidence(input.decrement.expectedConfidence) ||
        input.decrement.by !== 0.25) {
        return false;
    }
    return true;
}
function strictProfile(raw) {
    if (!isPlainObject(raw))
        return { ok: false, error: 'invalid' };
    const checked = validate(raw, 'save');
    if (checked.unsupportedSchemaVersion)
        return { ok: false, error: 'unsupported-schema-version' };
    if (checked.errors.length > 0 || checked.warnings.length > 0)
        return { ok: false, error: 'invalid' };
    const gaps = raw.known_gap_types;
    const seen = new Set();
    for (const gap of gaps) {
        if (!GAP_TYPES.includes(gap.type))
            continue;
        if (seen.has(gap.type))
            return { ok: false, error: 'invalid' };
        seen.add(gap.type);
    }
    return { ok: true, raw, gaps };
}
function currentConfidence(gaps, type) {
    return gaps.find((gap) => gap.type === type)?.confidence ?? null;
}
export function learn(input) {
    if (!validateLearnInput(input))
        return { ok: false, error: 'invalid' };
    const { profilePath, fromEnv } = resolveProfilePath();
    if (fromEnv && profilePath.trim() === '')
        return { ok: false, error: 'env-path-invalid' };
    // Avoid creating ~/.im-dumb for a profile that does not exist. The read
    // under the lock remains authoritative if the file changes after preflight.
    const preflight = readProfileFile();
    if (!preflight.ok && preflight.error === 'missing')
        return preflight;
    if (!preflight.ok && preflight.error === 'env-path-invalid')
        return preflight;
    const lock = acquireProfileLock(profilePath);
    if (!lock.ok)
        return lock;
    try {
        const read = readProfileFile();
        if (!read.ok)
            return read;
        const checked = strictProfile(read.parsed);
        if (!checked.ok)
            return checked;
        const primaryCurrent = currentConfidence(checked.gaps, input.type);
        if (primaryCurrent !== input.expectedConfidence) {
            return { ok: false, error: 'conflict', currentConfidence: primaryCurrent };
        }
        if (input.decrement !== undefined) {
            const decrementCurrent = currentConfidence(checked.gaps, input.decrement.type);
            if (decrementCurrent !== input.decrement.expectedConfidence) {
                return { ok: false, error: 'conflict', currentConfidence: decrementCurrent };
            }
        }
        const nextPrimary = primaryCurrent === null ? 0.5 : Math.min(1, primaryCurrent + 0.25);
        if (primaryCurrent === null)
            checked.gaps.push({ type: input.type, confidence: nextPrimary });
        else
            checked.gaps.find((gap) => gap.type === input.type).confidence = nextPrimary;
        if (input.decrement !== undefined) {
            const gap = checked.gaps.find((entry) => entry.type === input.decrement.type);
            gap.confidence = Math.max(0, gap.confidence - input.decrement.by);
        }
        const write = atomicWriteProfile(profilePath, checked.raw);
        if (write !== 'ok')
            return { ok: false, error: write };
        const saved = validate(checked.raw, 'save');
        return { ok: true, applied: true, profile: saved.profile };
    }
    finally {
        releaseProfileLock(lock);
    }
}
// ---------------------------------------------------------------------------
// CLI entry (D15 stream/exit contract): stdout = JSON only, stderr = warnings.
// load  -> exit 0 {profile, warnings} | exit 1 {error}
// validate -> exit 0 {valid: true, profile, warnings} | exit 1 {valid: false, ...}
// save  -> exit 0 {profile, warnings} | exit 1 {error, ...}
// learn -> exit 0 {applied, profile} | exit 1 {error, ...} | malformed input exit 2
// usage error -> exit 2
// ---------------------------------------------------------------------------
function printJson(value) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
}
function printWarnings(warnings) {
    for (const warning of warnings) {
        process.stderr.write(`warning: ${warning}\n`);
    }
}
function runLoad() {
    const result = load();
    if (result.ok) {
        printWarnings(result.warnings);
        printJson({ profile: result.profile, warnings: result.warnings });
        return 0;
    }
    printJson({ error: result.error });
    return 1;
}
function runValidate() {
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
function runSave() {
    let raw;
    try {
        raw = readFileSync(0, 'utf8');
    }
    catch {
        printJson({ error: 'usage', message: 'failed to read profile JSON from stdin' });
        return 2;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
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
    }
    else {
        printJson({ error: result.error });
    }
    return 1;
}
function runLearn() {
    let raw;
    try {
        raw = readFileSync(0, 'utf8');
    }
    catch {
        printJson({ error: 'usage', message: 'failed to read learn JSON from stdin' });
        return 2;
    }
    let parsed;
    try {
        if (raw.trim() === '')
            throw new Error('empty');
        parsed = JSON.parse(raw);
    }
    catch {
        printJson({ error: 'usage', message: 'stdin is not valid JSON' });
        return 2;
    }
    // Parsed JSON with a closed-shape/schema error is a typed operational
    // `invalid` outcome (exit 1), not a stdin parse/usage failure (exit 2).
    const result = learn(parsed);
    if (result.ok) {
        printJson({ applied: true, profile: result.profile });
        return 0;
    }
    printJson(result.error === 'conflict'
        ? { error: result.error, currentConfidence: result.currentConfidence }
        : { error: result.error });
    process.stderr.write(`learn: ${result.error}\n`);
    return 1;
}
function main() {
    const [command, ...rest] = process.argv.slice(2);
    if (command === undefined || rest.length > 0) {
        process.stderr.write('usage: profile.js <load|validate|save|learn>\n');
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
        case 'learn':
            process.exitCode = runLearn();
            return;
        default:
            process.stderr.write('usage: profile.js <load|validate|save|learn>\n');
            process.exitCode = 2;
    }
}
function isDirectExecution(argv1) {
    if (argv1 === undefined)
        return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(argv1)).href;
    }
    catch {
        return false;
    }
}
if (isDirectExecution(process.argv[1])) {
    main();
}
