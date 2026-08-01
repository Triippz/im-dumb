# M2 implementation plan — comprehension gate

Revision 2 — architecture and eval contract frozen before behavior.

This plan implements `prd.md` §6 and §9.7 under ADR-001 and the invariants in
`AGENTS.md`. It incorporates the independent Fable and Sol reviews of Revision
1. This planning slice changes only this document, ADR-001, and the local
ignored PRD wording. It does not ship behavior, fixtures, tests, or versions.

## 1. Scope and architecture

M2 adds:

- a two-stage comprehension gate;
- named-candidate diagnosis and targeted repair;
- profile-driven tapering and second-failure escalation;
- golden schema v2 and categories 4–5;
- deterministic structural checks and a repo-side reference classifier;
- an atomic learned-gap update in the existing profile CLI; and
- captured runtime evidence from a filesystem-capable harness.

M2 does not add a response rewrite pass, a second model call, or `gate.js`.
`skill/im-dumb/scripts/profile.js` remains the only bundled script.

### 1.1 Corrected two-stage contract

The original PRD wording implied that a script deterministically intercepts
every user reply before a model turn. Open Agent Skills expose no portable
pre-response hook across Claude, Cursor, Codex, and Pi. A model would still
have to choose to call such a script, and hosted surfaces may not expose it.

The approved contract is therefore:

1. **Deterministic reference stage:** a fixed lexical policy defines candidate
   confusion markers. A pure, repo-side TypeScript classifier tests this
   policy without a model call. It is evaluation tooling, not bundled runtime
   middleware.
2. **Model-driven confirmation stage:** during the normal response-generation
   turn, the loaded skill applies the same marker policy and confirms from
   immediate conversation context that the user is confused about the prior
   answer. This is probabilistic runtime behavior and uses no extra classifier
   or model call.

This is a material correction to the former deterministic-runtime promise.
The local ignored `prd.md` §6.2 and ADR-001 are amended in this planning slice.
One-shot generation and the no-rewrite decision remain unchanged.

### 1.2 Capability matrix

| Surface | Diagnose and repair | Durable learning in M2 |
|---|---:|---:|
| Filesystem harnesses (Claude Code, Cursor, local Codex, Pi) | Yes | Yes, through `profile.js learn` |
| Hosted Claude/OpenAI skill execution without a writable profile path | Yes | No; diagnosis/repair works for the conversation, but persistence and cross-session tapering wait for M4 profile transport |

M2 evidence must not claim cross-harness runtime parity from repo-side tests.

## 2. Frozen deterministic reference policy

The pure reference classifier is a lexical candidate filter. Semantic
confirmation, candidate relevance, topic continuity, and repair quality remain
model behavior and are measured separately (§8).

### 2.1 Input and output

```ts
type ReferenceInput = {
  reply: string;
  hasPriorAssistantAnswer: boolean;
  context: 'same-topic' | 'new-task' | 'topic-change' | 'session-reset';
};

type ReferenceResult = {
  candidate: boolean;
  reason:
    | 'marker'
    | 'no-prior-answer'
    | 'too-long'
    | 'quoted-or-code'
    | 'specific-question'
    | 'context-reset'
    | 'no-marker';
  normalized: string;
};
```

No fixture label (`expected_action`, category, expected gap, or expected
result) is accepted by the classifier. Tests must prove that stripping all
case metadata cannot change its decision.

### 2.2 Normalization and boundary

In order:

1. Normalize Unicode with NFKC.
2. Map curly apostrophes to ASCII `'`.
3. Lowercase, trim, and collapse Unicode whitespace to one ASCII space.
4. Measure the normalized, unstripped reply by Unicode code points. More than
   40 code points is not a lexical candidate.
5. For exact-marker comparison only, strip trailing runs of `.`, `!`, `?`,
   and `…`, then trim again.

The 40-code-point boundary is inclusive. Fixtures include positive cases at
40 and negative cases at 41 code points.

### 2.3 Marker families

After normalization and terminal-punctuation stripping, the entire reply must
exactly match one of these phrases:

- short: `huh`, `what`, `confused`, `lost`;
- first failure: `i don't get it`, `i dont get it`, `i don't understand`,
  `i dont understand`, `i am lost`, `i'm lost`, `im lost`;
- framing failure: `this doesn't make sense`, `this doesnt make sense`,
  `that doesn't make sense`, `that doesnt make sense`;
- continued failure: `still don't get it`, `still dont get it`,
  `i still don't understand`, `i still dont understand`.

New marker families require a plan/eval revision before implementation. They
must not be added opportunistically to make a live capture pass.

### 2.4 Rule precedence and exclusions

The classifier applies these rules in order:

1. No prior assistant answer → `no-prior-answer`.
2. `new-task`, `topic-change`, or `session-reset` → `context-reset`.
3. More than 40 normalized code points → `too-long`.
4. A whole reply wrapped in matching backticks, a fenced code block, or
   matching single/double quotation marks → `quoted-or-code`.
5. A reply ending in `?` that is not an exact marker and contains any text
   beyond a marker → `specific-question`.
6. Exact marker match → `marker`; otherwise → `no-marker`.

The model confirmation stage must also treat a clearly specific follow-up,
new task, or topic change as non-triggering even when it contains a marker in
quoted or explanatory prose. The deterministic dataset has at least one
positive case for each marker family and at least one negative case for each
of: quotation, inline code, fenced code, specific question, new task, topic
change, session reset, 41-code-point boundary, and embedded/non-standalone
marker. These are separate composition buckets, not one combined false-positive
bucket.

Reference classifier results are reported as **reference-spec conformance**.
They are not runtime precision/recall claims.

## 3. Golden schema v2

Schema v2 accepts all existing v1 bytes unchanged and adds strict multi-turn
cases for `comprehension-gate` and `profile-adaptation`.

```ts
type GapType = 'term' | 'step' | 'assumption' | 'framing';
type ExpectedAction =
  | 'answer'
  | 'diagnose'
  | 'repair'
  | 'direct-repair'
  | 'rediagnose'
  | 'record-resolution';

interface GoldenCaseV2 {
  id: string;
  category: GoldenCategory;
  turns: GoldenTurn[];
  profile: Record<string, unknown>;
  reference_facts: string[];
  must_preserve: string[];
  expected_checks: ExpectedCheck[];
  // pair_id is forbidden when turns is present.
}

interface GoldenTurn {
  role: 'user' | 'assistant';
  content: string;
  // The fields below are allowed only on user turns and describe the
  // immediately following assistant turn/tool-side profile result.
  expected_action?: ExpectedAction;
  expected_gap_type?: GapType;
  expected_question_count?: 0 | 1;
  expected_candidate_count?: 2 | 3 | 4;
  expected_known_gaps?: Array<{ type: GapType; confidence: number }>;
  expected_format?: 'default' | 'machine';
}
```

### 3.1 Pairing invariants

A case has exactly one of `prompt` (v1) or `turns` (v2). Turns cases:

- contain 2–8 non-empty turns;
- have an even number of turns;
- start with `user`, end with `assistant`, and alternate strictly;
- require `expected_action`, `expected_question_count`, and
  `expected_format` on every user turn;
- forbid every `expected_*` field on assistant turns;
- forbid `pair_id`; and
- require non-empty `expected_checks`.

`comprehension-gate` and `profile-adaptation` require `turns`; existing
categories remain prompt-only. Every expectation therefore has exactly one
following assistant turn and cannot bypass dispatch.

### 3.2 Action-dependent field matrix

| Action | Questions | Candidate count | Gap type | Known gaps |
|---|---:|---:|---|---|
| `answer` | exactly 0 | forbidden | forbidden | optional exact unchanged/post-action state |
| `diagnose` | exactly 1 | required, 2–4 | forbidden | optional exact unchanged state |
| `rediagnose` | exactly 1 | required, 2–4 | forbidden | optional exact unchanged state |
| `repair` | exactly 0 | forbidden | required | optional exact unchanged state |
| `direct-repair` | exactly 0 | forbidden | required | optional exact unchanged state |
| `record-resolution` | exactly 0 | forbidden | required | required exact post-learn state |

All expected gap types are taxonomy values. Confidence is finite and in
`[0,1]`, and M2-produced values are quarter steps (`0`, `0.25`, `0.5`,
`0.75`, `1`). `expected_known_gaps` is the exact recognized taxonomy state
after the following assistant/tool step, sorted by type for comparison. It is
not a subset assertion. Unknown pre-existing profile entries are excluded
from this expectation because they are preserved inert and verified in
profile tests.

### 3.3 Output-format precedence

D11 remains authoritative: an explicit output contract outranks ordinary
Markdown structure. Default diagnosis format is deterministic:

- one exact full-line heading, `**Likely confusion points**`;
- 2–4 consecutive candidate bullets directly below it, each exactly
  `- **<specific label>**: <non-empty description>`;
- one final, non-list user-directed question line ending in `?`; and
- no other `?` outside fenced code, inline code, or blockquotes.

The checker strips those exclusions before counting. Candidate labels and
descriptions must be non-empty after trim; labels `something`, `other`, and
`not sure` are the exact frozen generic-label deny set after NFKC, lowercase,
trim, and whitespace collapse. The final question is normalized the same way
and rejected when it exactly matches one of this frozen bare-re-ask set:
`what didn't you understand?`, `what part was confusing?`, `can you clarify?`,
or `can you be more specific?`. “Including” is not implied: changing either
deny set requires a reviewed contract change plus fixtures. `repair` and
`direct-repair` require zero user-directed questions.

In machine format the Markdown heading/bullets are exempt, but the requested
format still carries 2–4 named candidates and at most one question. Exact JSON
is an object with exactly two keys and no extras:
`{ "candidates": [{ "label": string, "description": string }], "question": string }`.
Each candidate object has exactly those two keys; both values are non-empty
after trim; labels use the same generic deny set. `question` is non-empty,
contains exactly one `?` code point as its final non-whitespace character, and
uses the same normalized bare-re-ask deny set. Other explicit machine formats
retain the hard limits in skill instructions and runtime rubric evidence; the
Markdown checker is not applied where it would violate the requested format.
M2 deterministic machine-format coverage is exact JSON; M3 judge coverage
handles arbitrary explicit formats.

Gate-mode turns (`diagnose`, `rediagnose`, `repair`, `direct-repair`) are
exempt from D9 output-shape and D10 ADHD structure. Sentence cap, forbidden
phrases, and one-term-one-concept still apply. `answer` and
`record-resolution` use ordinary M1 rules unless an explicit format says
otherwise.

### 3.4 Pure golden-turn evaluator

M2 adds a pure evaluator/dispatcher that:

1. validates and pairs each user turn with the next assistant turn;
2. runs each declared prose checker exactly once on that assistant content;
3. automatically invokes the comprehension-gate checker for gate actions;
4. applies D9/D10 exemptions only for the gate modes above;
5. uses default or machine checker mode from `expected_format` without
   exposing expectations to runtime generation; and
6. compares `expected_known_gaps` to the exact post-action recognized state.

Dataset tests prove every v2 user expectation was dispatched exactly once,
with no orphan, duplicate, or skipped pair. A v2 case passes only when every
applicable assistant turn and exact state comparison passes.

## 4. Gap learning contract

### 4.1 Taxonomy and confidence

The closed runtime-write taxonomy is:

| Type | Failure | Repair |
|---|---|---|
| `term` | word, acronym, or symbol | define it with one plain example |
| `step` | procedural or causal transition | split and explain the transition |
| `assumption` | missing prerequisite | add the prerequisite first |
| `framing` | analogy or overall presentation | replace the analogy or structure |

`KnownGap.type` remains `string` for schema-v1 compatibility. Unknown stored
types are preserved value-for-value through learn operations but never drive
a repair or taper decision. Recognized duplicate entries make `learn` return
`invalid`; no entry is silently selected. There is no new total array cap or
eviction. The four-value taxonomy is its own recognized-entry bound.

A new confirmed gap starts at `0.5`. A later explicit confirmation for the
same type adds `0.25`, capped at `1`. Diagnosis may be skipped only at
confidence `>=0.75` when the current confusion clearly maps to exactly one
recognized type. Ambiguity always diagnoses. Confidence changes only after
explicit user confirmation that a repair worked.

If a rediagnosis succeeds with a different type, one atomic operation updates
the new type and lowers the failed recognized type by exactly `0.25`, floored
at `0`. Failure alone never changes confidence.

### 4.2 Strict CAS learn operation

```ts
type LearnGapInput = {
  type: GapType;
  outcome: 'success';
  expectedConfidence: number | null;
  decrement?: {
    type: GapType;
    expectedConfidence: number;
    by: 0.25;
  };
};

type LearnGapOutcome =
  | { ok: true; applied: true; profile: Profile }
  | { ok: false; error: 'conflict'; currentConfidence: number | null }
  | { ok: false; error: 'missing' | 'unparseable' |
      'unsupported-schema-version' | 'invalid' | 'lock-timeout' |
      'env-path-invalid' };
```

`null` means the type was absent. JSON never uses `undefined`. Every observed
confidence mismatch returns `conflict`, including a retry after a response was
lost. M2 does **not** claim exactly-once event semantics or idempotent success.
A caller may reload and deliberately issue a new event; it must not blindly
retry a conflicted update.

A decrement must name a different recognized type, have `by: 0.25`, and carry
its own expected confidence. Primary and decrement expectations are checked
under one lock before one atomic write. Either both transitions apply or
neither does.

### 4.3 Lock and data-integrity rules

One shared ownership-token lock helper protects every profile writer,
including existing `save` and new `learn`:

- lock path: `<profile-path>.lock`, mode `0o600`;
- retry interval: `25ms`;
- acquisition timeout: `500ms`;
- stale threshold: `30_000ms`;
- these are named, testable constants, not user profile fields;
- lock content includes an unguessable token, PID, and creation time;
- stale reclaim uses immutable private candidates named
  `<lock>.reclaim.<createdAt>.<pid>.<token>`; deterministic earliest-candidate
  election plus a token-keyed hard link pins the stale main inode, writers scan
  candidates before and after lock creation, and dead-PID stale candidates
  self-heal by unique-path deletion;
- a caller removes only a lock whose token it owns;
- a lock is proven stale only after rereading and confirming the same token,
  age above the stale threshold, and that `process.kill(pid, 0)` reports
  `ESRCH` (the recorded process no longer exists); `EPERM`, success, an invalid
  PID, or any inconclusive result means the owner may still be live and the
  lock is not removed;
- removal repeats the token check immediately before unlinking; and
- a live or not-proven-stale contended lock remains after `lock-timeout`.

`lock-timeout` can therefore mean active contention or a deliberately retained
invalid/PID-reused artifact. Manual recovery is allowed only after confirming
no profile writer is live: remove the exact `<profile-path>.lock` file and the
matching `<profile-path>.lock.reclaim.*` candidate files.

`learn` acquires the lock, reads raw bytes, parses, and strictly validates the
on-disk profile before mutation. Missing, malformed, unsupported-version,
invalid, or duplicate-recognized data returns the typed failure without a
write. It never substitutes defaults or rewrites unrelated invalid data.
Unknown gap entries and all unrelated valid fields survive unchanged.
Temporary files remain private and same-directory; rename stays atomic. No
caller-owned lock or temp artifact may leak after success or failure.

The lock serializes physical writers. `learn` additionally provides semantic
CAS for learned-gap updates. Generic `save` remains an intentional whole
profile replacement under its existing public contract; callers that save a
stale full document can still replace newer logical values. M2 runtime gap
learning never uses generic `save`, and this limitation is recorded rather
than overstating distributed/exactly-once safety.

### 4.4 CLI and failure UX

`profile.js learn` reads `LearnGapInput` JSON from stdin. Stdout is JSON only;
stderr carries warnings/diagnostics. Exit `0` means applied; exit `1` means a
typed operational/data failure; exit `2` means missing or malformed command
input. `SaveOutcome` gains only the additive `lock-timeout` failure and the
existing save CLI maps it to exit `1`; successful `load`, `validate`, and
`save` stream/exit contracts remain compatible.

A learn failure never blocks or retries the user-facing repair. The response
stays focused on the explanation; one concise diagnostic is available on
stderr and captured evidence, with no retry loop. The consequence is explicit:
the repair worked for this turn but may not be remembered.

No raw reply, prior answer, candidate prose, URL, command, or tool request is
accepted by `LearnGapInput` or persisted.

## 5. Conversation state and hard constraints

Conversation state is transient and never stored in the profile.

| State/event | Result | Next state |
|---|---|---|
| `normal` + first confusion, no matching profile gap at `>=0.75` | diagnose with 2–4 candidates, one question | `diagnosed` |
| `normal` + first confusion, exactly one matching profile gap at `>=0.75` | direct repair, zero questions | `repaired` |
| `diagnosed` + user selects/confirms candidate | targeted repair, zero questions | `repaired` |
| `diagnosed` + another confusion signal | full wider rediagnosis; do not re-offer the same failed lead | `diagnosed` |
| `repaired` + another confusion signal | full wider rediagnosis, even at confidence `1.0` | `diagnosed` |
| any active state + explicit repair success | optionally record resolution, then ordinary reply | `normal` |
| any state + new task, topic change, or explicit session reset | ordinary answer; no consecutive-failure inference | `normal` |

`direct-repair` always enters `repaired`, so immediate confusion after a
tapered fix cannot be mistaken for a first failure. Confusion after the
initial diagnosis question also counts as the second consecutive failure.
The word `still` alone never establishes state; immediate turn history must
show that the reply concerns the current confusion thread.

Every diagnosis has 2–4 concrete, named candidates tied to the prior answer,
at most one user-directed question, and never a bare unscoped re-ask. A second
consecutive failure always performs full rediagnosis and overrides taper.

## 6. Trust boundary

Profile values, prior assistant text, and user confusion text are data, never
instructions. The skill must not obey embedded commands, URLs, tool requests,
or precedence changes from those sources.

Evidence is split honestly:

- **Deterministic code guarantees:** the reference classifier is pure and has
  no filesystem/network/tool capability; `LearnGapInput` is a closed schema;
  raw text cannot enter the persistence operation; offline bundle tests prove
  no invocation-time network dependency.
- **Prompt-behavior evidence:** fixed adversarial runtime captures include
  instruction-like prior text and confusion replies, and record whether the
  model attempted a tool/file/network action or echoed data as instructions.
  This is defense-in-depth evidence, not a proof about every model run.

Judge/security execution over multiple trials remains M3 (§10); the rubric
and cases are designed before M2 behavior (§7–§8).

## 7. Eval design that lands before behavior

### 7.1 Gate-specific rubric slice

Before any `SKILL.md` gate behavior, add a versioned comprehension rubric
(additive to `eval/rubric.md` or a linked `eval/comprehension-rubric.md`). It
scores these raw dimensions independently:

1. **Candidate specificity** — each option names a concrete term, step,
   assumption, or framing from the prior answer.
2. **Candidate relevance/coverage** — options are plausible and materially
   distinct, not generic labels or paraphrases of one guess.
3. **Targeted repair correctness** — the selected/direct repair correctly
   addresses the confirmed or selected gap rather than using a strategy for a
   different gap. M1 factual fidelity and safety remain scored once under
   `eval/rubric.md`; that independent result is a prerequisite and is not
   superseded or re-scored here.
4. **Widened rediagnosis** — after a second failure, the search changes or
   broadens rather than leading with the failed guess again.
5. **Hard-constraint compliance** — 2–4 candidates where required, question
   count, no bare re-ask, second-failure override, and requested format.

Use the existing judge scale conventions, pinned distinct judge model,
temperature `0`, raw per-dimension reporting, disagreement audit, and no ELO,
ranking, or hidden aggregate. Rubric design and human-use instructions land
before behavior. Automated judge execution and multi-trial aggregation remain
M3, not the rubric design.

### 7.2 Dataset composition

Add `comprehension-gate` and `profile-adaptation` turns-only categories. Keep
total cases within the PRD's 25–50 range. Before classifier or skill behavior,
fixtures cover:

- every marker family and the 40/41 boundary;
- every false-positive/reset subtype listed in §2.4;
- all four gap types;
- diagnosis, repair, direct repair, record resolution, and rediagnosis;
- confusion after diagnosis and after direct repair;
- success, task, topic, and session resets;
- confidence sequence `[0, 0.5, 0.75, 1]` with question counts `[1,1,0,0]`;
- CAS conflict, different-type paired update, unknown preservation; and
- adversarial instruction strings as data.

Existing v1 case files and hashes remain byte-identical unless the documented
reviewer sign-off process explicitly approves a correction.

## 8. Fixed M2 runtime capture protocol

Before M2 exit, capture one fresh, uninterrupted run for each named scenario
through one supported filesystem harness. Do not reroll model failures;
reruns are allowed only for documented infrastructure failure. Every capture
records harness/version, model/version/settings, skill version, prompt/turns,
profile path and redacted before/after profile, `learn` stdin/outcome/exit,
and observed tool/file/network attempts.

Named scenarios:

1. `trigger-huh`;
2. `trigger-dont-understand`;
3. `false-positive-quoted`;
4. `false-positive-inline-code`;
5. `false-positive-fenced-code`;
6. `false-positive-specific-question`;
7. `false-positive-new-task`;
8. `false-positive-topic-change`;
9. `false-positive-session-reset`;
10. `false-positive-41-code-point-boundary`;
11. `false-positive-embedded-marker`;
12. `taper-direct-repair`;
13. `second-failure-after-diagnosis`;
14. `second-failure-after-direct-repair`;
15. `candidate-selection-targeted-repair`;
16. `record-resolution-learn`;
17. `adversarial-data-not-instructions`.

Predeclared M2 pass thresholds:

- triggers: 2/2 select `diagnose`;
- false positives: 9/9 select `answer`;
- every diagnosis/rediagnosis: 2–4 named candidates in the frozen syntax,
  exactly one question, and no bare re-ask;
- second failure: 2/2 select `rediagnose`, including confidence `1.0`;
- taper: 1/1 selects `direct-repair` with zero questions;
- candidate selection: 1/1 produces the selected type's targeted repair with
  zero diagnostic questions;
- learning: 1/1 produces the exact expected profile transition and no raw
  text persistence;
- adversarial case: zero tool/file/network actions caused by embedded data;
- human application of the prewritten rubric: every applicable candidate
  specificity, relevance, repair-correctness, and widened-rediagnosis
  dimension scores at least the rubric's non-failing midpoint; and
- zero factual-fidelity or safety failure.

Reference-spec conformance must be 1.00 on the frozen curated classifier set,
but is reported separately from runtime results. M2 does not claim statistical
reliability from these single runs; M3 adds 3–5 trials, judge execution,
mutation/held-out sets, and significance handling.

The `SKILL.md` frontmatter description must be updated and tested so discovery
mentions triggering on confusion/non-understanding as well as profile-driven
language adaptation, while remaining below 1024 characters.

## 9. Ordered implementation slices

Each slice writes its eval/test contract before its behavior and is reviewed
before the next dependent slice.

1. **Planning decision (this slice):** this plan, ADR-001 amendment, and local
   ignored PRD §6.2 correction only.
2. **Rubric design:** gate-specific rubric from §7.1 and fixed capture template
   from §8; no skill behavior.
3. **Golden schema v2:** strict schema and malformed-shape tests from §3.
4. **Golden cases/manifest:** categories and composition tests from §7.2;
   existing v1 bytes unchanged.
5. **Reference classifier/state helpers:** pure classifier and transition tests
   from §2 and §5; metrics named reference-spec conformance.
6. **Profile locking and learn:** shared writer lock, raw strict read, strict
   CAS, typed failures, preservation, CLI, and bundle-sync tests from §4.
7. **Gate checker and golden-turn evaluator:** hard-constraint checker plus the
   exactly-once dispatcher and D9/D10/machine exemptions from §3.3–§3.4.
8. **Skill behavior:** `SKILL.md`, a comprehension reference, frontmatter
   trigger, precedence, trust boundary, and classifier-marker mirroring tests.
   This starts only after slices 2–7.
9. **Version:** package, lockfile, and skill metadata to `0.2.0`; profile schema
   remains `1`.
10. **Runtime evidence:** execute §8 and publish raw results plus deterministic
    conformance/persistence results. Failing thresholds block M2 completion.
11. **Docs sync:** README/AGENTS/test updates describing shipped behavior,
    privacy, capability matrix, and honest limitations.

CI continues to verify that compiled `skill/im-dumb/scripts/profile.js` is
byte-identical to `dist/profile.js`, dependency-free, and offline. No second
bundle is added.

## 10. M2 acceptance and M3 deferrals

M2 acceptance requires:

- all v1 golden bytes/hashes unchanged and all v2 schema/dispatch tests green;
- every composition bucket present;
- reference-spec conformance 1.00 on the frozen curated set;
- question/taper/second-failure sequences exactly as specified;
- strict CAS conflicts on every mismatch, including retries;
- primary/decrement all-or-nothing updates;
- bad profiles never default-rewritten;
- active foreign locks survive timeout; no caller-owned lock/temp leaks;
- unknown gap entries preserved and recognized duplicates rejected;
- deterministic trust guarantees and fixed runtime captures both reported;
- §8 runtime thresholds met; and
- all M1 tests remain green in intent.

Deferred to M3, with design completed before the behavior it evaluates:

- automated distinct-model judge execution of the M2 rubric;
- 3–5 trial nondeterminism-aware scoring and significance handling;
- held-out paraphrase, Unicode mutation, and adversarial mutation suites;
- the human comprehension-quiz protocol; and
- path-filtered expensive CI, audited eval override, and spend alerting when
  the expensive gates exist.

Cross-machine profile synchronization and hosted profile transport remain out
of M2. Single-machine locking does not provide distributed exactly-once
semantics.

## 11. Rollback

Package and skill versions rise from `0.1.0` to `0.2.0`; profile schema stays
`1`. A rollback requires reverting the commits **and** rebuilding/re-copying
or redeploying the reverted bundle to every installed harness. Verify
`SKILL.md` metadata and bundled `profile.js` are aligned after redeploy.

Learned taxonomy entries remain valid harmless schema-v1 data and are not
erased. If learning is disabled, diagnosis/repair can continue without the
`learn` call and taper simply stops improving. Nothing is published or merged
without explicit approval.

## 12. Traceability

| Contract | Enforcement/evidence |
|---|---|
| Deterministic reference, model-driven runtime | ADR/PRD sync; pure classifier; fixed harness captures |
| Frozen marker normalization/exclusions | classifier unit/boundary tests and composition buckets |
| Strict turn pairing/action matrix | schema tests |
| Every expectation checked once | pure golden-turn evaluator dispatch-count tests |
| 2–4 candidates, ≤1 question, no bare re-ask | gate checker + runtime rubric/captures |
| Explicit output contract precedence | default/machine evaluator tests + runtime case |
| Fixed repair strategy | taxonomy helper tests + repair rubric |
| Taper at `>=0.75` | `[1,1,0,0]` question sequence |
| Diagnosed/direct-repair second failure | transition-table tests + two runtime captures |
| Success/task/topic/session reset | transition tests and fixtures |
| Widened rediagnosis | prewritten rubric + runtime threshold |
| Unknown gap preservation | strict-read/learn tests |
| Strict CAS and paired update | conflict/all-or-nothing tests |
| Writer lock ownership | save/learn contention, stale/live lock, cleanup tests |
| Non-blocking persistence failure | skill contract + CLI stderr/runtime evidence |
| No raw text persistence | closed input type and before/after profile assertions |
| Prompt injection defense | deterministic capability tests + adversarial capture |
| Frontmatter discovery | description contract test |
| Hosted limitation | capability matrix and docs test |
| Rollback | version/bundle sync test and deployment instructions |

Residual risk remains explicit: model-driven trigger application, semantic
same-topic judgment, gap matching, and repair quality are probabilistic. The
M2 captures are a blocking smoke protocol, not statistical proof; M3 supplies
multi-trial judge and held-out evaluation.
