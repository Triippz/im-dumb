# Evaluation stack

How `im-dumb` is evaluated, and why this design resists the usual ways LLM
evals get gamed or quietly weakened.

This file is the map. Detailed contracts live next to the artifacts they
govern — do not duplicate them here.

| Artifact | Role |
|---|---|
| [`golden/`](golden/README.md) | Fixed cases + expectations (schema, categories, edit rules) |
| [`rubric.md`](rubric.md) | M1 semantic judge dimensions (factual fidelity, constraint compliance, safety) |
| [`comprehension-rubric.md`](comprehension-rubric.md) | M2 semantic dimensions for diagnose / repair / rediagnose |
| [`baselines/`](baselines/README.md) | M1 baseline/candidate captures + token-overhead protocol |
| [`runtime/`](runtime/README.md) | M2 live harness captures; immutable attempt history |

Private product requirements (§9) define the five gates and pre-code checklist;
public milestone plans under `docs/plans/` are the shipped contracts.

## What we are measuring

The skill must change *how* a model answers for one person (vocabulary, jargon
policy, sentence shape, ADHD structure) and, when confusion is signaled, repair
that confusion with named candidates — not a vague “what do you mean?”

Evals therefore ask three different questions:

1. **Structure** — Did the reply obey hard, checkable constraints?
2. **Semantics** — Did it stay true, safe, and useful for the stated persona /
   repair action?
3. **Live behavior** — When a real model runs the skill, does it take the
   right gate action on the right turns?

Code answers (1). A pinned rubric answers (2). Preserved runtime captures
answer (3). Mixing those layers is how false confidence appears.

## Layers

```
golden case ──► Layer 1 checkers (deterministic) ──► must pass first
                     │
                     ▼
              semantic rubric (LLM judge / human review)
                     │
                     ▼
              runtime harness evidence (live model, immutable)
```

### Layer 1 — deterministic checkers

`src/checkers.ts`, `src/comprehension-gate-checker.ts`, and related CLIs.

Examples: sentence cap, forbidden phrases, one-term-one-concept, ADHD shape,
frontmatter/profile schema, golden-case schema, frozen diagnosis first line,
question-count caps, second-failure rediagnosis override.

Why this layer is “good”:

- Failures are reproducible without a model.
- CI can block structural regressions (`npm test`, `npm run verify:golden`).
- The judge is never asked to re-score what code can verify for free, and
  never overrides a Layer 1 error.

### Golden dataset

`eval/golden/cases/` + `manifest.json` (SHA-256 per case). Categories map to
product-requirements §9.4: persona baselines, jargon decomposition, ADHD on/off
pairs, comprehension-gate triggers/false positives, profile-adaptation
sequences, and adversarial cases.

Why this layer is “good”:

- **Eval before behavior** (AGENTS invariant 7): cases and rubrics land before
  the skill behavior they gate.
- **Manifest drift check** — silent case edits fail CI.
- **Published-case edit rule** — changing an already-merged case needs named
  reviewer sign-off on that id; “it was failing” is not a reason.
- **False-positive cases** — quoted/code/`huh` boundaries must *not* trigger
  diagnosis; a gate that fires on everything is not a gate.
- **Turns schema** — multi-turn cases fix `expected_action` and question /
  candidate counts so the evaluator cannot invent a softer target after the
  fact.

### Semantic rubrics (Layer 2 design; runner at M3)

`eval/rubric.md` (M1) and `eval/comprehension-rubric.md` (M2 v0.2).

Why this layer is “good”:

- Dimensions are **separable pass/fail**, not a collapsed ranking.
- **No ELO / preference aggregation** — psychometric work cited in the product
  requirements found that ranked LLM judges often ignore their own rubrics and
  collapse dimensions into one latent factor.
- Failures must cite evidence (contradicted fact, unmapped candidate, etc.),
  not a bare score.
- Readability formulas (e.g. Flesch-Kincaid) are supporting signals only, never
  standalone success.

M1 live spot-checks used the rubric manually and reported honestly (**0 of 5**
full passes in a single trial). That is recorded risk, not a silent rewrite of
the bar. An automated multi-trial judge runner is **M3**.

### Runtime evidence (M2)

`eval/runtime/` — filesystem harness (`capture-m2.ts` / `evaluate-m2.ts`) plus
preserved attempts under `m2/attempts/`.

Why this layer is “good”:

- **Immutable attempts** — a failing trial is never overwritten. Prompt
  changes get a new attempt number; prior failures stay for audit.
- **No capture editing** — thresholds are not met by trimming assistant text.
- **Protocol faults ≠ behavior fails** — zero responses / harness bugs are
  labeled and may retry the same attempt number only after the fault is fixed.
- **Predeclared scenario thresholds** — triggers, false positives, second
  failure, taper, learning, adversarial data — listed in the comprehension
  rubric before captures run.
- **Transcript is data** — embedded “instructions” in user content must not
  drive tools or rewrite the skill contract.

Honest status: M2 implementation and evidence are in-tree; **automated runtime
thresholds are not yet passing** on the models tried (see latest
`m2/attempt-*-outcome.md`). That gap is why runtime acceptance stays open —
not a reason to weaken fixtures.

## What CI enforces today

| Check | What it proves |
|---|---|
| `npm test` / typecheck | Checkers, schema, skill-doc contracts, unit behavior |
| `npm run verify:golden` | Dataset validates; manifest hashes match disk |
| `npm run verify:dist-sync` | Bundled `profile.js` matches the built artifact |
| PR title lint | Conventional Commits for SemVer history |

Not yet a required PR check: full Layer 2 offline smoke suite with a pinned
judge model (deliberately deferred to M3 in AGENTS.md).

## M3 (planned)

Layer 2 runner + Gate 3 token budget + human quiz protocol:
[`docs/plans/m3-eval-infrastructure.md`](../docs/plans/m3-eval-infrastructure.md).

Dual path: local CLI dry-run without secrets; live pinned judge in CI when a
repo secret exists. Gate 5 shadow/canary stays deferred. M2 runtime acceptance
remains open and is not a prerequisite for starting M3 infrastructure.

## How to extend without rotting the gate

1. Add or change a **case** → update `eval/golden/`, regenerate/verify the
   manifest; if editing a published case, get named sign-off on that id.
2. Add a **hard constraint** → implement a checker + tests first; wire
   `expected_checks` on cases that should exercise it.
3. Change **semantic meaning of pass** → bump the rubric version; leave prior
   review artifacts labeled with the old instrument.
4. Capture **runtime** → new attempt directory; never rewrite prior captures
   to clear a red report.

If a change makes the suite easier to pass without making the skill better for
users, it is the wrong change.
