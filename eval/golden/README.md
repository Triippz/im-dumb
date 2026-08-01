# Golden dataset

Normative reference for `eval/golden/`. This is the source of truth for the
golden case schema (D14, `src/golden-schema.ts`), the category mapping back
to prd.md §9.4, and the rules for editing this dataset. If code and this
document disagree, treat the disagreement as a bug — file it, don't silently
follow whichever one is more convenient.

## Layout

```
eval/golden/
  README.md        # this file
  manifest.json     # sorted case ids + per-file SHA-256 (drift-checked in CI)
  cases/*.json      # one golden case per file, filename == "<id>.json"
```

## Category mapping (prd.md §9.4 → D14 `category` enum)

prd.md §9.4 lists six category types for the golden dataset. M1 ships
categories 1, 2, 3, and 6 as prompt-only cases. M2 adds categories 4 and 5
as schema-v2 turns-only cases (see "Schema v2" below and
`docs/plans/m2-comprehension-gate.md` §3). `GOLDEN_CATEGORIES` includes all
six; a category 4 or 5 case must use `turns[]`, not `prompt`. AGENTS.md
invariant 7 records this per-milestone eval-first sequence as deliberate,
not drift.

| # | prd.md §9.4 description | D14 `category` value | shape | status |
|---|---|---|---|---|
| 1 | Baseline explanations across three knowledge-level personas | `persona-baseline` | prompt (v1) | shipped |
| 2 | Jargon-heavy source material requiring lossless decomposition | `jargon-decomposition` | prompt (v1) | shipped |
| 3 | ADHD-mode on/off pairs on identical input | `adhd-pair` | prompt (v1) | shipped |
| 4 | Comprehension-gate trigger cases, including false positives | `comprehension-gate` | turns (v2) | shipped in M2 slice 4 |
| 5 | Profile-adaptation multi-turn sequences | `profile-adaptation` | turns (v2) | shipped in M2 slice 4 |
| 6 | Adversarial cases inducing jargon leakage or unsafe over-simplification | `adversarial` | prompt (v1) | shipped |
| 7 | M5 durable learning assets (markdown/HTML explainers) | `learning-asset` | prompt (v1) | shipped in M5 phase 1 |

Category 7 is an M5 addition beyond prd.md §9.4's original six: an asset
request is a single prompt turn, so it reuses the v1 prompt shape and adds
the `learning-asset` structural checker on top of the usual language checks.

`PROMPT_ONLY_CATEGORIES` (categories 1/2/3/6/7) and `TURNS_ONLY_CATEGORIES`
(categories 4/5) are exported from `src/golden-schema.ts` and are exhaustive:
a case's `category` fixes whether it must carry `prompt` or `turns[]`, and
`validateGoldenCase()` rejects the mismatched shape either way.

`adversarial` cases are further tagged by case-id substring rather than a
separate schema field, since v1 has no subtype field: an id containing
`jargon-leakage` targets category 6's jargon-leakage failure mode, and an id
containing `unsafe-oversimplification` targets its unsafe-simplification
failure mode.

## D14 golden case schema — shared fields (v1 and v2)

Hand-rolled validator: `validateGoldenCase()` in `src/golden-schema.ts`. No
ajv, no JSON Schema — the validator function *is* the schema. Every case,
whatever its category, carries these fields:

| Field | Type | Required | Bounds / policy |
|---|---|---|---|
| `id` | string | yes | non-empty; stable once published, never reused; must equal the case's filename minus `.json` |
| `category` | enum | yes | `persona-baseline \| jargon-decomposition \| adhd-pair \| adversarial \| comprehension-gate \| profile-adaptation \| learning-asset` |
| `prompt` | string | exactly one of `prompt`/`turns` | non-empty; required and only allowed for `PROMPT_ONLY_CATEGORIES` (1/2/3/6) |
| `turns` | `GoldenTurn[]` | exactly one of `prompt`/`turns` | required and only allowed for `TURNS_ONLY_CATEGORIES` (4/5); see "Schema v2" below |
| `profile` | object | yes | arbitrary plain object — a partial `Profile` (src/profile.ts) overlay merged onto defaults by the eval runner; not validated against the full profile schema here |
| `reference_facts` | string[] | yes | at most 20 items, each at most 200 chars; must be true statements about the prompt's subject matter |
| `must_preserve` | string[] | yes | at most 20 items, each at most 200 chars; terms/facts a compliant response must not drop |
| `expected_checks` | `{checker, expect}[]` | yes | non-empty; `checker` ∈ `CHECKER_IDS` (src/checkers.ts): `sentence-cap \| forbidden-phrases \| one-term-one-concept \| output-shape \| adhd-structure \| frontmatter \| profile-schema \| golden-case-schema`; `expect` ∈ `pass \| fail \| warn` |
| `pair_id` | string | no | non-empty when present; forbidden when `turns` is present; see pair invariant below |

A case has **exactly one** of `prompt` or `turns` — never both, never
neither. Which one is required is fixed by `category`: `validateGoldenCase()`
rejects a `PROMPT_ONLY_CATEGORIES` case that supplies `turns`, and rejects a
`TURNS_ONLY_CATEGORIES` case that supplies `prompt`.

### Pair invariant (`adhd-pair`, enforced by `validateGoldenCaseSet()`)

A `pair_id` must name **exactly two** cases in the set, and those two cases
must:
- share an identical `prompt`,
- share an identical `profile` except for `adhd_mode`, and
- differ on `profile.adhd_mode` (one `true`, one `false`).

`validateGoldenCaseSet()` also rejects duplicate case `id`s across the set.

### Case ids

Case `id` is stable and never reused — once a case ships, its id is a
permanent handle for trend tracking across runs. Each case file is named
`<id>.json` so the id is discoverable from the filesystem without opening the
file.

## Manifest (`manifest.json`)

`manifest.json` records, for every case file, its `id`, repo-relative
`path`, and a SHA-256 hex digest of the file's exact on-disk contents,
sorted by `id`. `generateManifest()` produces this shape; `verifyManifest()`
diffs it against the current `cases/` directory and reports drift (added,
removed, or content-changed cases) — CI runs this to block silent dataset
edits from slipping past review.

## Schema v2 — `turns[]` (M2 §3)

Schema v2 adds a `turns[]` shape for `comprehension-gate` and
`profile-adaptation` cases, alongside the existing single-`prompt` shape used
by all M1 categories. **v1 cases remain valid under v2 unchanged** — a case
with a bare `prompt` (no `turns`) validates exactly as it did under schema
v1, and manifest hashing is unaffected by the schema change since it hashes
file bytes, not schema version. M2 slice 3 ships the schema and validator; slice 4 ships the turns-only
category case files. The golden-turn evaluator/dispatcher (§3.4), which pairs
a real assistant reply against these expectations, remains a later slice and
is not implemented yet.

### `GoldenTurn`

| Field | Type | On `user` turns | On `assistant` turns |
|---|---|---|---|
| `role` | `'user' \| 'assistant'` | required | required |
| `content` | string | required, non-empty | required, non-empty |
| `expected_action` | enum, see below | required | forbidden |
| `expected_question_count` | `0 \| 1` | required, fixed by action | forbidden |
| `expected_format` | `'default' \| 'machine'` | required | forbidden |
| `expected_candidate_count` | `2 \| 3 \| 4` | action-dependent, see matrix | forbidden |
| `expected_gap_type` | `GapType`, see below | action-dependent, see matrix | forbidden |
| `expected_known_gaps` | `{type, confidence}[]` | action-dependent, see matrix | forbidden |

Turn objects reject any field name outside this table (both cases). A
`GoldenCase`'s `turns` array:

- has **2–8** entries, an **even** count;
- **starts with `user`, ends with `assistant`, and strictly alternates** —
  every user turn is immediately followed by the assistant turn it
  describes, so every expectation is dispatched against exactly one reply;
  and
- forbids `pair_id` on the case entirely (the v1 `adhd-pair` pairing
  mechanism does not apply to turns-shaped cases).

### `ExpectedAction` and the action matrix (M2 §3.2)

`expected_action` ∈ `answer | diagnose | repair | direct-repair | rediagnose
| record-resolution`. Each action fixes exactly what the other expectation
fields on that user turn may or must contain:

| Action | `expected_question_count` | `expected_candidate_count` | `expected_gap_type` | `expected_known_gaps` |
|---|---:|---:|---|---|
| `answer` | exactly `0` | forbidden | forbidden | optional |
| `diagnose` | exactly `1` | required, `2`-`4` | forbidden | optional |
| `rediagnose` | exactly `1` | required, `2`-`4` | forbidden | optional |
| `repair` | exactly `0` | forbidden | required | optional |
| `direct-repair` | exactly `0` | forbidden | required | optional |
| `record-resolution` | exactly `0` | forbidden | required | **required** |

"Optional" here is a schema-shape statement only: the field may be present
or absent. Whether an optional or required `expected_known_gaps` array
matches the real post-turn profile state is the golden-turn evaluator's job
(§3.4, a later slice), not this schema's. A CAS-conflict fixture represents a
stale expected confidence in user content and an unchanged exact recognized
post-state in `expected_known_gaps`. Its assistant reply stays user-facing;
the exact tool outcome and stderr diagnostic belong to profile `learn` tests
and fixed runtime evidence.

### `GapType` — closed taxonomy (M2 §4.1)

`GapType` ∈ `term | step | assumption | framing` (taxonomy order, used below
for sorting). This is the same closed set the runtime `learn` operation
writes; `expected_gap_type` and every `expected_known_gaps[].type` must be
one of these four values.

### `expected_known_gaps` — confidence and ordering

Each entry is exactly `{ type: GapType, confidence: number }` (no other
keys). `confidence` must be a finite number in `[0, 1]` **and** a quarter
step — one of `0, 0.25, 0.5, 0.75, 1`; any other value (including `NaN` and
`±Infinity`) is rejected. Within one `expected_known_gaps` array:

- no two entries may share the same `type` (rejected as a duplicate), and
- entries must appear **sorted by `type` in taxonomy order**
  (`term, step, assumption, framing`) — this is the exact recognized-state
  comparison order the golden-turn evaluator will use, not a subset or
  any-order assertion.

## Editing existing cases: reviewer sign-off rule

Editing a **published** case file (one already merged, not one added in the
same PR) requires **explicit reviewer sign-off**, noted by name in the PR
description, on that specific edit. This is the failure mode prd.md §9.4
warns about directly: quietly loosening a failing case is how an eval gate
gets weakened without anyone deciding to weaken it. A reviewer approving the
PR in general is not sufficient — the sign-off must call out the edited
case(s) by id and state why the edit is correct (e.g. a fact was wrong, not
"this case was failing so I changed the expectation").

Adding new cases, or deleting a case entirely with a stated reason, doesn't
require this extra sign-off — only in-place edits to a case's `prompt`,
`turns`, `profile`, `reference_facts`, `must_preserve`, or `expected_checks`
do.

### Turns-case evaluation scope

For a turns case, `reference_facts` contains only subject-matter facts used
for M1 fidelity; gate and persistence policy belongs in composition tests,
not factual judging. `reference_facts` and `must_preserve` apply across the
case's assistant turns as one transcript. Each `must_preserve` value must
appear in at least one assistant reply. Declared `expected_checks` apply to
each assistant reply independently. Cases containing a gate action do not
declare the D9 `output-shape` or D10 `adhd-structure` checkers; sentence cap,
forbidden phrases, and one-term-one-concept still apply. Explicit machine
output declares a prose checker only when its frozen fixture can be evaluated
by that checker.

`profile` is the pre-sequence state. `expected_known_gaps` is the exact
recognized post-action state for its paired assistant/tool step; preserved
unknown entries are intentionally excluded. Assistant content is user-facing
and never has to expose persistence diagnostics. Exact `learn` stdout,
stderr, CAS, locking, and unknown-entry preservation are executable profile
and runtime evidence, not claims inferred from conversational prose.

### M2 published-case review notes

The `profile-adaptation-second-failure-after-direct` exemplar was revised to
remove a rediagnosis candidate that re-offered the failed multi-server
proposition. This is a contract correction, not a threshold change: the
independent attempt-21 contract arbitration explicitly signed off on the edit;
the PR description names that review and its evidence. The manifest records
the new hash.

Before M2 slice 4 merged, independent Fable and Sol review corrected the
embedded-marker fixture from a 47-code-point `too-long` overlap to a distinct
at-most-40-code-point `no-marker` case. The published-case rule above applies
to every later in-place edit.

## Dataset size

25-50 cases total (prd.md §9.4). Current count and per-category breakdown are
enforced by `test/golden-dataset.test.ts`, not restated here as a number that
would drift out of sync with the actual dataset.
