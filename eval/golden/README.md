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
categories 1, 2, 3, and 6; categories 4 and 5 land at M2 (see "Schema v2"
below). AGENTS.md invariant 7 records this as a deliberate per-milestone
split, not drift.

| # | prd.md §9.4 description | D14 `category` value | M1 status |
|---|---|---|---|
| 1 | Baseline explanations across three knowledge-level personas | `persona-baseline` | shipped |
| 2 | Jargon-heavy source material requiring lossless decomposition | `jargon-decomposition` | shipped |
| 3 | ADHD-mode on/off pairs on identical input | `adhd-pair` | shipped |
| 4 | Comprehension-gate trigger cases, including false positives | — (M2, schema v2 `turns[]`) | deferred |
| 5 | Profile-adaptation multi-turn sequences | — (M2, schema v2 `turns[]`) | deferred |
| 6 | Adversarial cases inducing jargon leakage or unsafe over-simplification | `adversarial` | shipped |

`adversarial` cases are further tagged by case-id substring rather than a
separate schema field, since v1 has no subtype field: an id containing
`jargon-leakage` targets category 6's jargon-leakage failure mode, and an id
containing `unsafe-oversimplification` targets its unsafe-simplification
failure mode.

## D14 golden case schema (v1)

Hand-rolled validator: `validateGoldenCase()` in `src/golden-schema.ts`. No
ajv, no JSON Schema — the validator function *is* the schema.

| Field | Type | Required | Bounds / policy |
|---|---|---|---|
| `id` | string | yes | non-empty; stable once published, never reused; must equal the case's filename minus `.json` |
| `category` | enum | yes | `persona-baseline \| jargon-decomposition \| adhd-pair \| adversarial` |
| `prompt` | string | yes | non-empty |
| `profile` | object | yes | arbitrary plain object — a partial `Profile` (src/profile.ts) overlay merged onto defaults by the eval runner; not validated against the full profile schema here |
| `reference_facts` | string[] | yes | at most 20 items, each at most 200 chars; must be true statements about the prompt's subject matter |
| `must_preserve` | string[] | yes | at most 20 items, each at most 200 chars; terms/facts a compliant response must not drop |
| `expected_checks` | `{checker, expect}[]` | yes | non-empty; `checker` ∈ `CHECKER_IDS` (src/checkers.ts): `sentence-cap \| forbidden-phrases \| one-term-one-concept \| output-shape \| adhd-structure \| frontmatter \| profile-schema \| golden-case-schema`; `expect` ∈ `pass \| fail \| warn` |
| `pair_id` | string | no | non-empty when present; see pair invariant below |

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

## Schema v2 (forward note — M2)

Schema v1 (this document) covers single-turn cases only: one `prompt`, one
`profile`. M2 introduces schema v2 to add prd.md §9.4 categories 4
(comprehension-gate triggers) and 5 (profile-adaptation multi-turn
sequences), both of which need a multi-turn shape. Schema v2 adds a `turns[]`
field — an ordered list of `{prompt, profile?}` steps — alongside the
existing single-`prompt` shape.

**v1 cases remain valid under v2.** A case with a bare `prompt` (no
`turns[]`) is a one-turn case under either schema version; nothing in this
directory needs to be rewritten when v2 ships. Manifest hashing is unaffected
by the schema change, since it hashes file bytes, not schema version.

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
`profile`, `reference_facts`, `must_preserve`, or `expected_checks` do.

## Dataset size (M1 draft)

25-30 cases total (prd.md §9.4). Current count and per-category breakdown are
enforced by `test/golden-dataset.test.ts`, not restated here as a number that
would drift out of sync with the actual dataset.
