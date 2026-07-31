// ---------------------------------------------------------------------------
// M2 §2 — pure deterministic reference classifier
// (docs/plans/m2-comprehension-gate.md §2). Lexical candidate filter only:
// no IO, no fixture labels, no model/runtime behavior. Semantic confirmation,
// candidate relevance, and repair quality remain model behavior (§8).
// ---------------------------------------------------------------------------

export type ReferenceContext = 'same-topic' | 'new-task' | 'topic-change' | 'session-reset';

export interface ReferenceInput {
  reply: string;
  hasPriorAssistantAnswer: boolean;
  context: ReferenceContext;
}

export type ReferenceReason =
  | 'marker'
  | 'no-prior-answer'
  | 'too-long'
  | 'quoted-or-code'
  | 'specific-question'
  | 'context-reset'
  | 'no-marker';

export interface ReferenceResult {
  candidate: boolean;
  reason: ReferenceReason;
  normalized: string;
}

// M2 §2.3 — frozen marker families. Adding a phrase requires a plan/eval
// revision; do not extend opportunistically to make a live capture pass.
export const MARKER_PHRASES: readonly string[] = [
  // short
  'huh',
  'what',
  'confused',
  'lost',
  // first failure
  "i don't get it",
  'i dont get it',
  "i don't understand",
  'i dont understand',
  'i am lost',
  "i'm lost",
  'im lost',
  // framing failure
  "this doesn't make sense",
  'this doesnt make sense',
  "that doesn't make sense",
  'that doesnt make sense',
  // continued failure
  "still don't get it",
  'still dont get it',
  "i still don't understand",
  'i still dont understand',
] as const;

const MARKER_SET = new Set(MARKER_PHRASES);

const CONTEXT_RESET_VALUES = new Set<ReferenceContext>(['new-task', 'topic-change', 'session-reset']);

const MAX_CODE_POINTS = 40;

// M2 §2.2 steps 1-3 — NFKC, curly apostrophe to ASCII, lowercase, trim,
// collapse Unicode whitespace to one ASCII space.
export function normalizeReply(reply: string): string {
  return reply.normalize('NFKC').replace(/[‘’]/gu, "'").toLowerCase().trim().replace(/\s+/gu, ' ');
}

// M2 §2.2 step 5 — for exact-marker comparison only.
function stripTerminalPunctuation(normalized: string): string {
  return normalized.replace(/[.!?…]+$/u, '').trim();
}

// M2 §2.4 rule 4 — whole reply wrapped in matching backticks (inline or
// fenced), or matching single/double quotation marks.
function isWholeReplyWrapped(normalized: string): boolean {
  if (normalized.length < 2) return false;
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return true;
  }

  const leadingBackticks = normalized.match(/^`+/u)?.[0].length ?? 0;
  const trailingBackticks = normalized.match(/`+$/u)?.[0].length ?? 0;
  return leadingBackticks > 0 && leadingBackticks === trailingBackticks;
}

function containsMarkerText(value: string): boolean {
  for (const marker of MARKER_PHRASES) {
    let start = value.indexOf(marker);
    while (start !== -1) {
      const before = value[start - 1];
      const after = value[start + marker.length];
      const boundary = (char: string | undefined) => char === undefined || !/[\p{L}\p{N}']/u.test(char);
      if (boundary(before) && boundary(after)) return true;
      start = value.indexOf(marker, start + 1);
    }
  }
  return false;
}

// M2 §2.4 — rule precedence, checked in order; the first matching rule wins.
export function classifyComprehensionReply(input: ReferenceInput): ReferenceResult {
  const normalized = normalizeReply(input.reply);

  if (!input.hasPriorAssistantAnswer) {
    return { candidate: false, reason: 'no-prior-answer', normalized };
  }

  if (CONTEXT_RESET_VALUES.has(input.context)) {
    return { candidate: false, reason: 'context-reset', normalized };
  }

  if ([...normalized].length > MAX_CODE_POINTS) {
    return { candidate: false, reason: 'too-long', normalized };
  }

  if (isWholeReplyWrapped(normalized)) {
    return { candidate: false, reason: 'quoted-or-code', normalized };
  }

  const strippedForMarker = stripTerminalPunctuation(normalized);
  const isExactMarker = MARKER_SET.has(strippedForMarker);

  if (normalized.endsWith('?') && !isExactMarker && containsMarkerText(strippedForMarker)) {
    return { candidate: false, reason: 'specific-question', normalized };
  }

  if (isExactMarker) {
    return { candidate: true, reason: 'marker', normalized };
  }

  return { candidate: false, reason: 'no-marker', normalized };
}
