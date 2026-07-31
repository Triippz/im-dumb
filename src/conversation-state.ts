import { GAP_TYPES, type GapType } from './golden-schema.ts';

// ---------------------------------------------------------------------------
// M2 §5 — pure conversation-state transition helper. Transient dialogue
// phase only (docs/plans/m2-comprehension-gate.md §5): never read from or
// written to the profile. Confidence/taper thresholds mirror §4.1 but this
// module performs no persistence and no `learn` call; callers apply
// `LearnGapInput` separately using the gap types this module surfaces.
// ---------------------------------------------------------------------------

export type ConversationState =
  | { readonly phase: 'normal' }
  | { readonly phase: 'diagnosed'; readonly failedGapType?: GapType }
  | { readonly phase: 'repaired'; readonly activeGapType: GapType; readonly failedGapType?: GapType };

export const INITIAL_CONVERSATION_STATE: ConversationState = { phase: 'normal' };

export type ResetSource = 'new-task' | 'topic-change' | 'session-reset';

// A snapshot of recognized-taxonomy confidence as currently known to the
// caller (e.g. read from the profile before this turn). `type` is `string`,
// mirroring `KnownGap.type` (§4.1): unrecognized/unknown stored types must be
// passed through here too so this module can prove it never lets them
// qualify for taper, exactly like the runtime taxonomy bound.
export interface KnownGapSnapshot {
  readonly type: string;
  readonly confidence: number;
}

// Closed event set (§5 table rows). Every event is total: `ordinary` and
// `reset` are always valid from any phase; `confusion` is always valid;
// `candidate-selected` and `repair-success` are only valid in the phase the
// table implies they can occur in, and are rejected as `ok: false` in every
// other phase rather than inventing a transition or a learned gap.
export type ConversationEvent =
  | { readonly kind: 'reset'; readonly source: ResetSource }
  | { readonly kind: 'ordinary' }
  | {
      readonly kind: 'confusion';
      readonly knownGaps: readonly KnownGapSnapshot[];
      // Semantic model-stage result: exactly one gap clearly maps to this
      // confusion. Omit for no clear mapping or ambiguity.
      readonly clearGapType?: string;
    }
  | { readonly kind: 'candidate-selected'; readonly gapType: GapType }
  // The resolved gap is named by the caller, not inferred from
  // `state.activeGapType`: a single user turn can name which gap it means
  // and confirm success in the same breath (e.g. straight out of
  // 'diagnosed', with no intervening confirmed repair turn at all).
  | { readonly kind: 'repair-success'; readonly gapType: GapType };

export type ConversationAction =
  | 'answer'
  | 'diagnose'
  | 'repair'
  | 'direct-repair'
  | 'rediagnose'
  | 'record-resolution';

export type ConversationTransitionError =
  // `candidate-selected` outside `diagnosed`: nothing was offered to select.
  | 'candidate-selection-without-diagnosis'
  // `repair-success` while `normal`: no active gate interaction to resolve.
  | 'success-without-active-state'
  | 'success-gap-mismatch';

export interface ConversationTransitionOk {
  readonly ok: true;
  readonly action: ConversationAction;
  readonly state: ConversationState;
  // The gap now under discussion (direct-repair/repair) or just resolved
  // (record-resolution). Absent for answer/diagnose/rediagnose.
  readonly gapType?: GapType;
  // Set only when a confirmed repair (phase 'repaired') failed and widened
  // into rediagnosis (§4.1/§5): the caller pairs this with the eventually
  // confirmed new type in one atomic `learn` decrement. Never set from
  // 'diagnosed', which has no confirmed gap to blame.
  readonly failedGapType?: GapType;
}

export interface ConversationTransitionErrorResult {
  readonly ok: false;
  readonly error: ConversationTransitionError;
}

export type ConversationTransitionResult = ConversationTransitionOk | ConversationTransitionErrorResult;

// §4.1 — diagnosis may be skipped only at confidence >=0.75.
export const TAPER_CONFIDENCE_THRESHOLD = 0.75;

const RECOGNIZED_GAP_TYPES = new Set<string>(GAP_TYPES);

// §4.1/§5 — recognized types at >=0.75. Unknown types never qualify.
// Any recognized duplicate makes the snapshot ambiguous, so taper is
// disabled rather than silently choosing an entry.
function qualifyingGapTypes(knownGaps: readonly KnownGapSnapshot[]): GapType[] {
  const confidenceByType = new Map<GapType, number>();
  let hasRecognizedDuplicate = false;
  for (const gap of knownGaps) {
    if (!RECOGNIZED_GAP_TYPES.has(gap.type)) continue;
    const type = gap.type as GapType;
    if (confidenceByType.has(type)) {
      hasRecognizedDuplicate = true;
      continue;
    }
    confidenceByType.set(type, gap.confidence);
  }

  if (hasRecognizedDuplicate) return [];
  return GAP_TYPES.filter((type) => {
    const confidence = confidenceByType.get(type);
    return (
      confidence !== undefined &&
      Number.isFinite(confidence) &&
      confidence >= TAPER_CONFIDENCE_THRESHOLD &&
      confidence <= 1
    );
  });
}

function ok(action: ConversationAction, state: ConversationState, extra: { gapType?: GapType; failedGapType?: GapType } = {}): ConversationTransitionResult {
  return { ok: true, action, state, ...extra };
}

function err(error: ConversationTransitionError): ConversationTransitionResult {
  return { ok: false, error };
}

// M2 §5 — the entire transition table. Total: every (state, event) pair
// returns a result, never throws.
export function transitionConversationState(
  state: ConversationState,
  event: ConversationEvent,
): ConversationTransitionResult {
  switch (event.kind) {
    case 'reset':
      // Any state + new-task/topic-change/session-reset -> answer/normal.
      // No consecutive-failure inference; conversation-only, no profile touch.
      return ok('answer', { phase: 'normal' });

    case 'ordinary':
      // Ordinary same-topic input is answered without fabricating a failure.
      // Only explicit success or a context reset clears active state (§5).
      return ok('answer', state);

    case 'candidate-selected':
      if (state.phase !== 'diagnosed') {
        return err('candidate-selection-without-diagnosis');
      }
      // diagnosed + selection -> targeted repair/repaired, zero questions.
      // Preserve a prior failed repair for the eventual atomic paired update.
      return ok(
        'repair',
        { phase: 'repaired', activeGapType: event.gapType, ...(state.failedGapType ? { failedGapType: state.failedGapType } : {}) },
        { gapType: event.gapType },
      );

    case 'repair-success':
      if (state.phase === 'normal') {
        return err('success-without-active-state');
      }
      if (state.phase === 'repaired' && event.gapType !== state.activeGapType) {
        return err('success-gap-mismatch');
      }
      // Any active state (diagnosed or repaired) + explicit repair success ->
      // record-resolution/normal. A repaired state can only resolve its
      // active gap; preserve a different failed gap for one atomic decrement.
      const failedGapType = state.failedGapType === event.gapType ? undefined : state.failedGapType;
      return ok(
        'record-resolution',
        { phase: 'normal' },
        { gapType: event.gapType, ...(failedGapType ? { failedGapType } : {}) },
      );

    case 'confusion':
      if (state.phase === 'normal') {
        const qualifying = qualifyingGapTypes(event.knownGaps);
        if (
          event.clearGapType !== undefined &&
          RECOGNIZED_GAP_TYPES.has(event.clearGapType) &&
          qualifying.includes(event.clearGapType as GapType)
        ) {
          // The semantic model stage mapped this confusion to exactly one
          // recognized type, and that type qualifies for taper.
          const gapType = event.clearGapType as GapType;
          return ok('direct-repair', { phase: 'repaired', activeGapType: gapType }, { gapType });
        }
        // No clear qualifying mapping (including semantic ambiguity) always
        // diagnoses, regardless of how many profile entries are confident.
        return ok('diagnose', { phase: 'diagnosed' });
      }

      // diagnosed/repaired + another confusion signal -> full wider
      // rediagnosis; second failure always overrides taper, even when the
      // just-repaired gap sits at confidence 1.0.
      if (state.phase === 'repaired') {
        return ok(
          'rediagnose',
          { phase: 'diagnosed', failedGapType: state.activeGapType },
          { failedGapType: state.activeGapType },
        );
      }
      return ok(
        'rediagnose',
        state.failedGapType ? { phase: 'diagnosed', failedGapType: state.failedGapType } : { phase: 'diagnosed' },
        state.failedGapType ? { failedGapType: state.failedGapType } : {},
      );
  }
}
