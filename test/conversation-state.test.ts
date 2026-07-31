import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  INITIAL_CONVERSATION_STATE,
  TAPER_CONFIDENCE_THRESHOLD,
  transitionConversationState,
  type ConversationEvent,
  type ConversationState,
  type ConversationTransitionOk,
  type ConversationTransitionResult,
  type KnownGapSnapshot,
  type ResetSource,
} from '../src/conversation-state.ts';
import { GAP_TYPES, type GapType } from '../src/golden-schema.ts';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const casesDir = path.join(repoRoot, 'eval', 'golden', 'cases');

// ---------------------------------------------------------------------------
// Result-narrowing helpers -- avoid ad hoc `as` casts on the union result.
// ---------------------------------------------------------------------------

function expectOk(result: ConversationTransitionResult): ConversationTransitionOk {
  if (!result.ok) {
    assert.fail(`expected ok:true, got ok:false with error "${result.error}"`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Event builders
// ---------------------------------------------------------------------------

function confusion(knownGaps: readonly KnownGapSnapshot[] = [], clearGapType?: string): ConversationEvent {
  return { kind: 'confusion', knownGaps, ...(clearGapType === undefined ? {} : { clearGapType }) };
}

function gap(type: string, confidence: number): KnownGapSnapshot {
  return { type, confidence };
}

const RESET_SOURCES: ResetSource[] = ['new-task', 'topic-change', 'session-reset'];

test('taper threshold is exported as the frozen prompt/runtime value', () => {
  assert.equal(TAPER_CONFIDENCE_THRESHOLD, 0.75);
});

// ---------------------------------------------------------------------------
// §5 row 1 — normal + first confusion, no clear >=0.75 type -> diagnose/diagnosed
// ---------------------------------------------------------------------------

test('normal + confusion with no known gaps -> diagnose/diagnosed', () => {
  const result = transitionConversationState(INITIAL_CONVERSATION_STATE, confusion([]));
  assert.deepEqual(result, { ok: true, action: 'diagnose', state: { phase: 'diagnosed' } });
});

test('normal + confusion with every recognized type below 0.75 -> diagnose/diagnosed', () => {
  const knownGaps = GAP_TYPES.map((type, index) => gap(type, [0, 0.25, 0.5, 0.5][index]!));
  const result = expectOk(transitionConversationState(INITIAL_CONVERSATION_STATE, confusion(knownGaps)));
  assert.equal(result.action, 'diagnose');
  assert.deepEqual(result.state, { phase: 'diagnosed' });
});

test('normal + confusion where only an unknown type is at high confidence -> diagnose (unknown types never qualify)', () => {
  const result = transitionConversationState(INITIAL_CONVERSATION_STATE, confusion([gap('sequence', 1)]));
  assert.deepEqual(result, { ok: true, action: 'diagnose', state: { phase: 'diagnosed' } });
});

test('normal + confusion with two qualifying recognized types -> diagnose (ambiguity always diagnoses)', () => {
  const result = transitionConversationState(INITIAL_CONVERSATION_STATE, confusion([gap('term', 0.75), gap('step', 1)]));
  assert.deepEqual(result, { ok: true, action: 'diagnose', state: { phase: 'diagnosed' } });
});

test('normal + confusion with all four recognized types qualifying -> diagnose (ambiguity always diagnoses)', () => {
  const knownGaps = GAP_TYPES.map((type) => gap(type, 1));
  const result = transitionConversationState(INITIAL_CONVERSATION_STATE, confusion(knownGaps));
  assert.deepEqual(result, { ok: true, action: 'diagnose', state: { phase: 'diagnosed' } });
});

// ---------------------------------------------------------------------------
// §5 row 2 — normal + first confusion, exactly one clear type at >=0.75 ->
// direct-repair/repaired with gap
// ---------------------------------------------------------------------------

test('normal + confusion clearly mapped to one recognized type at >=0.75 -> direct-repair/repaired with that gap', () => {
  for (const type of GAP_TYPES) {
    for (const confidence of [0.75, 1]) {
      const result = transitionConversationState(INITIAL_CONVERSATION_STATE, confusion([gap(type, confidence)], type));
      assert.deepEqual(
        result,
        { ok: true, action: 'direct-repair', state: { phase: 'repaired', activeGapType: type }, gapType: type },
        `${type}@${confidence}`,
      );
    }
  }
});

test('normal + confusion: recognized duplicate entries disable taper instead of silently selecting one', () => {
  for (const duplicates of [
    [gap('term', 0.5), gap('term', 0.9)],
    [gap('term', 0.75), gap('term', 1)],
  ]) {
    const result = transitionConversationState(INITIAL_CONVERSATION_STATE, confusion(duplicates, 'term'));
    assert.deepEqual(result, { ok: true, action: 'diagnose', state: { phase: 'diagnosed' } });
  }
});

test('normal + confusion: one clear recognized type can taper while unknown entries stay inert', () => {
  const result = transitionConversationState(
    INITIAL_CONVERSATION_STATE,
    confusion([gap('framing', 1), gap('sequence', 0.6)], 'framing'),
  );
  assert.deepEqual(
    result,
    { ok: true, action: 'direct-repair', state: { phase: 'repaired', activeGapType: 'framing' }, gapType: 'framing' },
  );
});

test('confidence sequence [0, 0.5, 0.75, 1] against a single recognized type: taper only at >=0.75 (§4.1/§7.2)', () => {
  const expectedActions = ['diagnose', 'diagnose', 'direct-repair', 'direct-repair'];
  [0, 0.5, 0.75, 1].forEach((confidence, index) => {
    const result = expectOk(
      transitionConversationState(INITIAL_CONVERSATION_STATE, confusion([gap('assumption', confidence)], 'assumption')),
    );
    assert.equal(result.action, expectedActions[index], `confidence ${confidence}`);
  });
});

test('normal + confusion with high confidence but no clear semantic mapping diagnoses', () => {
  const result = transitionConversationState(INITIAL_CONVERSATION_STATE, confusion([gap('term', 1)]));
  assert.deepEqual(result, { ok: true, action: 'diagnose', state: { phase: 'diagnosed' } });
});

test('normal + confusion can clearly map one type even when another type also has high confidence', () => {
  const result = transitionConversationState(
    INITIAL_CONVERSATION_STATE,
    confusion([gap('term', 1), gap('step', 0.75)], 'step'),
  );
  assert.deepEqual(result, {
    ok: true,
    action: 'direct-repair',
    state: { phase: 'repaired', activeGapType: 'step' },
    gapType: 'step',
  });
});

test('invalid confidence and unknown clear mappings never qualify for taper', () => {
  for (const confidence of [Number.NaN, Number.POSITIVE_INFINITY, -0.25, 1.25]) {
    const result = transitionConversationState(INITIAL_CONVERSATION_STATE, confusion([gap('term', confidence)], 'term'));
    assert.deepEqual(result, { ok: true, action: 'diagnose', state: { phase: 'diagnosed' } });
  }
  const unknown = transitionConversationState(INITIAL_CONVERSATION_STATE, confusion([gap('sequence', 1)], 'sequence'));
  assert.deepEqual(unknown, { ok: true, action: 'diagnose', state: { phase: 'diagnosed' } });
});

// ---------------------------------------------------------------------------
// §5 row 3 — diagnosed + candidate selection -> repair/repaired with selected gap
// ---------------------------------------------------------------------------

test('diagnosed + candidate-selected -> repair/repaired with the selected gap', () => {
  for (const type of GAP_TYPES) {
    const result = transitionConversationState({ phase: 'diagnosed' }, { kind: 'candidate-selected', gapType: type });
    assert.deepEqual(result, {
      ok: true,
      action: 'repair',
      state: { phase: 'repaired', activeGapType: type },
      gapType: type,
    });
  }
});

test('candidate-selected outside diagnosed is rejected, not invented, from normal and repaired', () => {
  const fromNormal = transitionConversationState(INITIAL_CONVERSATION_STATE, { kind: 'candidate-selected', gapType: 'term' });
  assert.deepEqual(fromNormal, { ok: false, error: 'candidate-selection-without-diagnosis' });

  const fromRepaired = transitionConversationState(
    { phase: 'repaired', activeGapType: 'term' },
    { kind: 'candidate-selected', gapType: 'step' },
  );
  assert.deepEqual(fromRepaired, { ok: false, error: 'candidate-selection-without-diagnosis' });
});

// ---------------------------------------------------------------------------
// §5 row 4 — diagnosed + another confusion signal -> full wider rediagnosis
// ---------------------------------------------------------------------------

test('diagnosed + confusion -> rediagnose/diagnosed, with no gap and no failed gap to expose', () => {
  const result = transitionConversationState({ phase: 'diagnosed' }, confusion([]));
  assert.deepEqual(result, { ok: true, action: 'rediagnose', state: { phase: 'diagnosed' } });
});

test('diagnosed + confusion never tapers into direct-repair, even when a type would otherwise qualify (second failure overrides taper)', () => {
  const result = transitionConversationState({ phase: 'diagnosed' }, confusion([gap('term', 1)]));
  assert.deepEqual(result, { ok: true, action: 'rediagnose', state: { phase: 'diagnosed' } });
});

// ---------------------------------------------------------------------------
// §5 row 5 — repaired + another confusion signal -> full wider rediagnosis,
// even at confidence 1.0, exposing the failed gap for a later paired update
// ---------------------------------------------------------------------------

test('repaired + confusion -> rediagnose/diagnosed and exposes the failed gap, even at confidence 1.0', () => {
  for (const type of GAP_TYPES) {
    const result = transitionConversationState(
      { phase: 'repaired', activeGapType: type },
      confusion([gap(type, 1)]),
    );
    assert.deepEqual(result, {
      ok: true,
      action: 'rediagnose',
      state: { phase: 'diagnosed', failedGapType: type },
      failedGapType: type,
    });
  }
});

test('repaired + confusion exposes the failed gap regardless of the knownGaps snapshot passed in (ignored for this branch)', () => {
  const result = transitionConversationState({ phase: 'repaired', activeGapType: 'framing' }, confusion([]));
  assert.deepEqual(result, {
    ok: true,
    action: 'rediagnose',
    state: { phase: 'diagnosed', failedGapType: 'framing' },
    failedGapType: 'framing',
  });
});

test('failed gap survives rediagnosis, candidate selection, and repair success for one paired update', () => {
  const rediagnosed = expectOk(
    transitionConversationState({ phase: 'repaired', activeGapType: 'framing' }, confusion([])),
  );
  const repaired = expectOk(
    transitionConversationState(rediagnosed.state, { kind: 'candidate-selected', gapType: 'step' }),
  );
  assert.deepEqual(repaired.state, { phase: 'repaired', activeGapType: 'step', failedGapType: 'framing' });
  const resolved = expectOk(
    transitionConversationState(repaired.state, { kind: 'repair-success', gapType: 'step' }),
  );
  assert.deepEqual(resolved, {
    ok: true,
    action: 'record-resolution',
    state: { phase: 'normal' },
    gapType: 'step',
    failedGapType: 'framing',
  });
});

// ---------------------------------------------------------------------------
// §5 row 6 — any active state + explicit repair success -> record-resolution,
// then normal
// ---------------------------------------------------------------------------

test('repaired + repair-success -> record-resolution/normal with the resolved gap', () => {
  for (const type of GAP_TYPES) {
    const result = transitionConversationState({ phase: 'repaired', activeGapType: type }, { kind: 'repair-success', gapType: type });
    assert.deepEqual(result, { ok: true, action: 'record-resolution', state: { phase: 'normal' }, gapType: type });
  }
});

test('diagnosed + repair-success -> record-resolution/normal (a single turn can name and confirm a gap with no intervening repair turn)', () => {
  const result = transitionConversationState({ phase: 'diagnosed' }, { kind: 'repair-success', gapType: 'step' });
  assert.deepEqual(result, { ok: true, action: 'record-resolution', state: { phase: 'normal' }, gapType: 'step' });
});

test('repair-success from normal is rejected, not invented: no active gate interaction exists to resolve', () => {
  const result = transitionConversationState(INITIAL_CONVERSATION_STATE, { kind: 'repair-success', gapType: 'term' });
  assert.deepEqual(result, { ok: false, error: 'success-without-active-state' });
});

test('repair-success cannot resolve a gap different from the one just repaired', () => {
  const result = transitionConversationState(
    { phase: 'repaired', activeGapType: 'term' },
    { kind: 'repair-success', gapType: 'step' },
  );
  assert.deepEqual(result, { ok: false, error: 'success-gap-mismatch' });
});

// ---------------------------------------------------------------------------
// §5 row 7 — new-task/topic-change/session-reset from any state -> answer/normal
// ---------------------------------------------------------------------------

test('reset from any phase, for every reset source, returns answer/normal with no leftover active gap', () => {
  const startingStates: ConversationState[] = [
    { phase: 'normal' },
    { phase: 'diagnosed' },
    { phase: 'repaired', activeGapType: 'term' },
  ];
  for (const source of RESET_SOURCES) {
    for (const state of startingStates) {
      const result = transitionConversationState(state, { kind: 'reset', source });
      assert.deepEqual(result, { ok: true, action: 'answer', state: { phase: 'normal' } }, `${source} from ${state.phase}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Ordinary input -> answer, and it never fabricates a second failure
// ---------------------------------------------------------------------------

test('ordinary same-topic input answers without clearing active state or inventing a failure', () => {
  const startingStates: ConversationState[] = [
    { phase: 'normal' },
    { phase: 'diagnosed' },
    { phase: 'diagnosed', failedGapType: 'framing' },
    { phase: 'repaired', activeGapType: 'assumption' },
  ];
  for (const state of startingStates) {
    const result = transitionConversationState(state, { kind: 'ordinary' });
    assert.deepEqual(result, { ok: true, action: 'answer', state }, state.phase);
  }
});

// ---------------------------------------------------------------------------
// Totality: every (phase, event-kind) pair returns a result, never throws
// ---------------------------------------------------------------------------

test('every phase/event combination is total: always returns ok:true or ok:false, never throws', () => {
  const phases: ConversationState[] = [
    { phase: 'normal' },
    { phase: 'diagnosed' },
    { phase: 'repaired', activeGapType: 'term' },
  ];
  const events: ConversationEvent[] = [
    { kind: 'reset', source: 'new-task' },
    { kind: 'ordinary' },
    confusion([]),
    { kind: 'candidate-selected', gapType: 'step' },
    { kind: 'repair-success', gapType: 'step' },
  ];
  for (const state of phases) {
    for (const event of events) {
      let result: ConversationTransitionResult | undefined;
      assert.doesNotThrow(() => {
        result = transitionConversationState(state, event);
      });
      assert.equal(typeof result!.ok, 'boolean');
    }
  }
});

// ---------------------------------------------------------------------------
// Fixture replay — the module reproduces the exact expected_action/
// expected_gap_type sequence committed in eval/golden/cases for every
// comprehension-gate/profile-adaptation case that exercises the gate. Each
// replay supplies the event a model would have decided (confusion/reset/
// ordinary/selection/success); it does not re-derive that decision from raw
// text, since that classification is the reference classifier's job (§2),
// not this module's.
// ---------------------------------------------------------------------------

interface RawTurn {
  role: string;
  content: string;
  expected_action?: string;
  expected_gap_type?: string;
  [key: string]: unknown;
}

interface RawCase {
  turns?: RawTurn[];
  profile: { known_gap_types?: KnownGapSnapshot[] };
  [key: string]: unknown;
}

function loadCase(id: string): RawCase {
  return JSON.parse(readFileSync(path.join(casesDir, `${id}.json`), 'utf8')) as RawCase;
}

function userTurns(raw: RawCase): RawTurn[] {
  return (raw.turns ?? []).filter((turn) => turn.role === 'user');
}

// Every fixture below opens with an ordinary scene-setting Q&A turn before
// the interesting gate turn; `firstAnswer` simulates that leading turn so
// the replay walks the same state a real conversation would produce.

test('fixture replay: comprehension-gate-marker-first-failure -> diagnose (confidence 0.5 does not taper)', () => {
  const raw = loadCase('comprehension-gate-marker-first-failure');
  const [firstAnswer, diagnoseTurn] = userTurns(raw);
  const answerResult = expectOk(transitionConversationState(INITIAL_CONVERSATION_STATE, { kind: 'ordinary' }));
  assert.equal(answerResult.action, firstAnswer!.expected_action);
  const result = expectOk(transitionConversationState(answerResult.state, confusion(raw.profile.known_gap_types ?? [])));
  assert.equal(result.action, diagnoseTurn!.expected_action);
});

test('fixture replay: comprehension-gate-marker-short-boundary -> diagnose (confidence 0 does not taper)', () => {
  const raw = loadCase('comprehension-gate-marker-short-boundary');
  const [firstAnswer, diagnoseTurn] = userTurns(raw);
  const answerResult = expectOk(transitionConversationState(INITIAL_CONVERSATION_STATE, { kind: 'ordinary' }));
  assert.equal(answerResult.action, firstAnswer!.expected_action);
  const result = expectOk(transitionConversationState(answerResult.state, confusion(raw.profile.known_gap_types ?? [])));
  assert.equal(result.action, diagnoseTurn!.expected_action);
});

test('fixture replay: comprehension-gate-marker-framing-taper -> direct-repair at confidence 0.75', () => {
  const raw = loadCase('comprehension-gate-marker-framing-taper');
  const [firstAnswer, directTurn] = userTurns(raw);
  const answerResult = expectOk(transitionConversationState(INITIAL_CONVERSATION_STATE, { kind: 'ordinary' }));
  assert.equal(answerResult.action, firstAnswer!.expected_action);
  const result = expectOk(
    transitionConversationState(
      answerResult.state,
      confusion(raw.profile.known_gap_types ?? [], directTurn!.expected_gap_type),
    ),
  );
  assert.equal(result.action, directTurn!.expected_action);
  assert.equal(result.gapType, directTurn!.expected_gap_type);
});

test('fixture replay: comprehension-gate-marker-continued-taper -> direct-repair at confidence 1', () => {
  const raw = loadCase('comprehension-gate-marker-continued-taper');
  const [firstAnswer, directTurn] = userTurns(raw);
  const answerResult = expectOk(transitionConversationState(INITIAL_CONVERSATION_STATE, { kind: 'ordinary' }));
  assert.equal(answerResult.action, firstAnswer!.expected_action);
  const result = expectOk(
    transitionConversationState(
      answerResult.state,
      confusion(raw.profile.known_gap_types ?? [], directTurn!.expected_gap_type),
    ),
  );
  assert.equal(result.action, directTurn!.expected_action);
  assert.equal(result.gapType, directTurn!.expected_gap_type);
});

test('fixture replay: profile-adaptation-direct-step-known-state -> exactly one of two known gaps qualifies', () => {
  const raw = loadCase('profile-adaptation-direct-step-known-state');
  const [firstAnswer, directTurn] = userTurns(raw);
  const answerResult = expectOk(transitionConversationState(INITIAL_CONVERSATION_STATE, { kind: 'ordinary' }));
  assert.equal(answerResult.action, firstAnswer!.expected_action);
  const result = expectOk(
    transitionConversationState(
      answerResult.state,
      confusion(raw.profile.known_gap_types ?? [], directTurn!.expected_gap_type),
    ),
  );
  assert.equal(result.action, directTurn!.expected_action);
  assert.equal(result.gapType, directTurn!.expected_gap_type);
});

test('fixture replay: profile-adaptation-selection-and-resolution -> diagnose, then candidate selection, then success', () => {
  const raw = loadCase('profile-adaptation-selection-and-resolution');
  const [firstAnswer, diagnoseTurn, repairTurn, resolutionTurn] = userTurns(raw);

  const answerResult = expectOk(transitionConversationState(INITIAL_CONVERSATION_STATE, { kind: 'ordinary' }));
  assert.equal(answerResult.action, firstAnswer!.expected_action);

  const diagnoseResult = expectOk(transitionConversationState(answerResult.state, confusion(raw.profile.known_gap_types ?? [])));
  assert.equal(diagnoseResult.action, diagnoseTurn!.expected_action);

  const repairResult = expectOk(
    transitionConversationState(diagnoseResult.state, { kind: 'candidate-selected', gapType: repairTurn!.expected_gap_type as GapType }),
  );
  assert.equal(repairResult.action, repairTurn!.expected_action);
  assert.equal(repairResult.gapType, repairTurn!.expected_gap_type);

  const resolutionResult = expectOk(
    transitionConversationState(repairResult.state, { kind: 'repair-success', gapType: resolutionTurn!.expected_gap_type as GapType }),
  );
  assert.equal(resolutionResult.action, resolutionTurn!.expected_action);
  assert.equal(resolutionResult.gapType, resolutionTurn!.expected_gap_type);
  assert.deepEqual(resolutionResult.state, { phase: 'normal' });
});

test('fixture replay: profile-adaptation-second-failure-after-diagnosis -> diagnose then rediagnose', () => {
  const raw = loadCase('profile-adaptation-second-failure-after-diagnosis');
  const [firstAnswer, diagnoseTurn, rediagnoseTurn] = userTurns(raw);
  const answerResult = expectOk(transitionConversationState(INITIAL_CONVERSATION_STATE, { kind: 'ordinary' }));
  assert.equal(answerResult.action, firstAnswer!.expected_action);
  const diagnoseResult = expectOk(transitionConversationState(answerResult.state, confusion([])));
  assert.equal(diagnoseResult.action, diagnoseTurn!.expected_action);
  const rediagnoseResult = expectOk(transitionConversationState(diagnoseResult.state, confusion([])));
  assert.equal(rediagnoseResult.action, rediagnoseTurn!.expected_action);
});

test('fixture replay: profile-adaptation-second-failure-after-direct -> direct-repair, rediagnose exposes the failed gap, resolution names a different gap for later paired decrement', () => {
  const raw = loadCase('profile-adaptation-second-failure-after-direct');
  const [firstAnswer, directTurn, rediagnoseTurn, resolutionTurn] = userTurns(raw);

  const answerResult = expectOk(transitionConversationState(INITIAL_CONVERSATION_STATE, { kind: 'ordinary' }));
  assert.equal(answerResult.action, firstAnswer!.expected_action);

  const directResult = expectOk(
    transitionConversationState(
      answerResult.state,
      confusion(raw.profile.known_gap_types ?? [], directTurn!.expected_gap_type),
    ),
  );
  assert.equal(directResult.action, directTurn!.expected_action);
  assert.equal(directResult.gapType, directTurn!.expected_gap_type);

  const rediagnoseResult = expectOk(transitionConversationState(directResult.state, confusion([])));
  assert.equal(rediagnoseResult.action, rediagnoseTurn!.expected_action);
  assert.equal(rediagnoseResult.failedGapType, directTurn!.expected_gap_type, 'the gap that failed to taper must be the one exposed for pairing');

  const resolutionResult = expectOk(
    transitionConversationState(rediagnoseResult.state, { kind: 'repair-success', gapType: resolutionTurn!.expected_gap_type as GapType }),
  );
  assert.equal(resolutionResult.action, resolutionTurn!.expected_action);
  assert.equal(resolutionResult.gapType, resolutionTurn!.expected_gap_type);
  assert.equal(resolutionResult.failedGapType, directTurn!.expected_gap_type);

  // The resolved gap differs from the failed gap: exactly the two ingredients
  // a caller needs to build one atomic §4.1 CAS learn (primary confirm +
  // decrement), never invented by this module itself.
  assert.notEqual(resolutionResult.gapType, rediagnoseResult.failedGapType);
});

test('fixture replay: profile-adaptation-success-reset -> direct-repair, resolution, then direct-repair again after the profile updates', () => {
  const raw = loadCase('profile-adaptation-success-reset');
  const [firstAnswer, firstDirect, resolution, secondDirect] = userTurns(raw);

  const answerResult = expectOk(transitionConversationState(INITIAL_CONVERSATION_STATE, { kind: 'ordinary' }));
  assert.equal(answerResult.action, firstAnswer!.expected_action);

  const firstResult = expectOk(
    transitionConversationState(
      answerResult.state,
      confusion(raw.profile.known_gap_types ?? [], firstDirect!.expected_gap_type),
    ),
  );
  assert.equal(firstResult.action, firstDirect!.expected_action);

  const resolutionResult = expectOk(
    transitionConversationState(firstResult.state, { kind: 'repair-success', gapType: resolution!.expected_gap_type as GapType }),
  );
  assert.equal(resolutionResult.action, resolution!.expected_action);
  assert.deepEqual(resolutionResult.state, { phase: 'normal' });

  // Simulates the profile after learn recorded the +0.25 confirmation (§4.1):
  // term now sits at confidence 1, so the very next confusion signal tapers
  // again instead of re-diagnosing.
  const secondResult = expectOk(
    transitionConversationState(resolutionResult.state, confusion([gap('term', 1)], secondDirect!.expected_gap_type)),
  );
  assert.equal(secondResult.action, secondDirect!.expected_action);
  assert.equal(secondResult.gapType, secondDirect!.expected_gap_type);
});

const RESET_FIXTURES: Array<{ id: string; source: ResetSource }> = [
  { id: 'profile-adaptation-active-session-reset', source: 'session-reset' },
  { id: 'profile-adaptation-active-state-reset', source: 'new-task' },
  { id: 'profile-adaptation-active-topic-reset', source: 'topic-change' },
];

for (const { id, source } of RESET_FIXTURES) {
  test(`fixture replay: ${id} -> answer, diagnose, reset(${source}) discards the pending diagnosis, diagnose again`, () => {
    const raw = loadCase(id);
    const [firstAnswer, firstDiagnose, resetTurn, secondDiagnose] = userTurns(raw);

    const answerResult = expectOk(transitionConversationState(INITIAL_CONVERSATION_STATE, { kind: 'ordinary' }));
    assert.equal(answerResult.action, firstAnswer!.expected_action);

    const diagnoseResult = expectOk(transitionConversationState(answerResult.state, confusion([])));
    assert.equal(diagnoseResult.action, firstDiagnose!.expected_action);
    assert.deepEqual(diagnoseResult.state, { phase: 'diagnosed' });

    const resetResult = expectOk(transitionConversationState(diagnoseResult.state, { kind: 'reset', source }));
    assert.equal(resetResult.action, resetTurn!.expected_action);
    assert.deepEqual(resetResult.state, { phase: 'normal' });

    const secondDiagnoseResult = expectOk(transitionConversationState(resetResult.state, confusion([])));
    assert.equal(secondDiagnoseResult.action, secondDiagnose!.expected_action);
  });
}

test('fixture replay: comprehension-gate-false-positive-context-resets -> every explicit reset answers and stays normal', () => {
  const raw = loadCase('comprehension-gate-false-positive-context-resets');
  const turns = userTurns(raw);
  let state: ConversationState = INITIAL_CONVERSATION_STATE;
  const events: ConversationEvent[] = [
    { kind: 'ordinary' },
    { kind: 'reset', source: 'new-task' },
    { kind: 'reset', source: 'topic-change' },
    { kind: 'reset', source: 'session-reset' },
  ];
  turns.forEach((turn, index) => {
    const result = expectOk(transitionConversationState(state, events[index]!));
    assert.equal(result.action, turn.expected_action);
    assert.deepEqual(result.state, { phase: 'normal' });
    state = result.state;
  });
});

test('fixture replay: comprehension-gate-false-positive-quoted-code -> every turn is ordinary answer, never mistaken for confusion', () => {
  const raw = loadCase('comprehension-gate-false-positive-quoted-code');
  let state: ConversationState = INITIAL_CONVERSATION_STATE;
  for (const turn of userTurns(raw)) {
    const result = expectOk(transitionConversationState(state, { kind: 'ordinary' }));
    assert.equal(result.action, turn.expected_action);
    state = result.state;
  }
  assert.deepEqual(state, { phase: 'normal' });
});

test('module has no runtime capability imports beyond the sibling gap taxonomy', () => {
  const source = readFileSync(path.join(repoRoot, 'src', 'conversation-state.ts'), 'utf8');
  const importLines = source.match(/^\s*import\s.*$/gmu) ?? [];
  assert.deepEqual(importLines.map((line) => line.trim()), ["import { GAP_TYPES, type GapType } from './golden-schema.ts';"]);
  assert.doesNotMatch(source, /\b(?:require|process|fetch)\s*(?:\.|\()/u);
  assert.doesNotMatch(source, /\bimport\s*\(/u);
});
