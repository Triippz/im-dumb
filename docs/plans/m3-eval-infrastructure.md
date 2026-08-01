# m3 implementation plan — eval infrastructure

Revision 1 — post-#7/#8; M2 runtime acceptance left open; no further capture loops unless asked.

## 1. Overview

**Problem**: Layer 1 checkers, golden cases, and rubrics exist, but there is still no multi-trial LLM-judge runner, no Gate 3 token-budget merge gate, and no path-filtered Layer 2 PR smoke. AGENTS.md still marks the Layer 2 offline smoke suite as aspirational until this milestone ships.

**Approach**: Reuse what already works (checkers, golden schema/turns, rubrics, token-overhead math, M2 evaluate harness patterns). Ship a **local-first Layer 2 CLI** that can dry-run without secrets, then wire the **same runner into CI** when a pinned judge secret is present. Expensive nightly (Gate 4) warns; shadow/canary (Gate 5) stays deferred.

**In scope (M3)**:
- Layer 2 offline smoke runner (local CLI + CI when secret exists)
- Pinned judge at temperature 0; separate from production model
- Multi-trial (3–5) scoring with tolerance vs trailing baseline + significance tests
- Gate 3 token-overhead enforcement (ceilings already in `eval/rubric.md` / `src/token-overhead.ts`)
- Result artifacts: skill version, judge model/version, dataset hash, trial count
- Path-filtered CI triggers for expensive steps
- Human comprehension-quiz protocol (documented + runnable checklist; not a product UI)
- Quarantine path for flaky judge cases (out of blocking set)
- Audited override path docs (label + second approver) — wiring may share M6 release workflow

**Out of scope (M3)**:
- Gate 5 shadow/canary on live traffic
- npm publish / tags / hosted skill upload (M6 + explicit approval)
- M4 installer / multi-harness packaging
- M5 learning assets
- More M2 runtime capture loops (open acceptance; resume only if asked)
- Editing golden cases or captures to make scores pass

## 2. Requirements

### Functional

1. **Layer 1 always first** — judge never re-scores what `src/checkers.ts` / comprehension-gate checkers already verify; Layer 1 failure short-circuits.
2. **Local CLI** — `npm run eval:smoke` (name TBD in impl) runs curated smoke set against candidate responses (fixtures and/or fresh generations when a generation key exists).
3. **Dry-run without secrets** — without judge credentials: validate cases, run Layer 1, emit a “judge skipped” report, exit 0 for structural readiness; do not fake judge passes.
4. **Live judge when configured** — env/config pins `JUDGE_MODEL` + version; temperature 0; provider adapter behind a tiny interface (OpenAI-compatible first; Cursor/Codex optional later).
5. **CI dual path** — if secret missing: run dry-run job (or skip live judge with explicit notice). If secret present: run live smoke and **block on regression**.
6. **Multi-trial** — 3–5 trials per judged case; report raw per-dimension pass/fail; no ELO/ranking aggregation (`eval/rubric.md`, `eval/comprehension-rubric.md`).
7. **Gate 3** — token-overhead report becomes blocking when trial count ≥ product floor (`REQUIRED_TRIAL_COUNT` today is 1; raise when multi-trial captures exist).
8. **Quiz protocol** — finalize human A/B comprehension-quiz procedure under `eval/` (materials, scoring sheet, pass criteria = quiz-accuracy delta, not judge score).
9. **Artifacts** — JSON + short markdown summary per run, gitignored or under `eval/results/` with clear “not golden” policy.

### Non-functional

- No new runtime deps in bundled `skill/im-dumb/scripts/` (eval runner may use Node + optional env API key; keep deps minimal — prefer `fetch` to hosted APIs).
- Judge spend must be path-filtered and skippable; spend alerting documented (webhook/log stub OK).
- Deterministic unit tests cover scoring math, artifact schema, dry-run behavior without network.

### Acceptance criteria

- [x] Public plan exists (`docs/plans/m3-eval-infrastructure.md`) before runner behavior ships (this file).
- [x] Local CLI dry-run green on clean checkout with no secrets.
- [x] Live smoke runnable with pinned judge when secret provided.
- [x] CI: dry-run always; live Layer 2 smoke required only when secret configured (document the toggle).
- [x] Gate 3 wired from existing token-overhead module with reported ceilings.
- [x] Human quiz protocol checked into `eval/` and linked from `eval/README.md`.
- [x] AGENTS.md aspirational Layer 2 note updated only when the PR check actually exists.
- [x] No ELO; raw per-dimension results only.
- [x] Flaky-case quarantine mechanism documented and tested.

### Traceability (prd §9 → delivery)

| §9 item | M3 delivery |
|---|---|
| Gate 1 lint/deterministic | Already CI (`npm test`, checkers, golden verify) |
| Gate 2 offline PR smoke | New runner + CI when secret present |
| Gate 3 cost/token budget | Enforce via `src/token-overhead.ts` |
| Gate 4 nightly full suite | Workflow `workflow_dispatch` / schedule; warn-only |
| Gate 5 shadow/canary | Deferred |
| §9.5 multi-trial + significance | Runner scoring module |
| §9.6 separable dimensions / no ELO | Rubrics already; runner must not collapse |
| §9.8 human quiz | Protocol doc + materials checklist |
| §9.9 path filter + override | CI paths + docs; label override with M6 if needed |
| §9.10 remaining checklist | Judge pin, re-baseline, quiz protocol, CI tiers |

## 3. Technical Design

### Layout additions

```
docs/plans/m3-eval-infrastructure.md   # this plan
eval/README.md                         # link M3 runner + quiz protocol
eval/smoke-manifest.json               # curated subset of golden ids for Gate 2
eval/quiz/README.md                    # human comprehension-quiz protocol
src/eval-runner.ts                     # orchestration (Layer1 → trials → judge → aggregate)
src/judge-client.ts                    # pinned model client (temp 0); no network in unit tests
src/eval-aggregate.ts                  # multi-trial thresholds, Welch / two-proportion helpers
.eval.env.example                      # JUDGE_API_KEY, JUDGE_MODEL, JUDGE_MODEL_VERSION
.github/workflows/ci.yml               # dry-run + conditional live smoke
.github/workflows/eval-nightly.yml     # Gate 4 warn-only (optional same PR or follow-up)
```

### Decisions

| ID | Decision |
|---|---|
| D1 | **Local-first, CI-when-secret** — one runner; two invocation modes (`--dry-run` / live). |
| D2 | **Smoke ≠ full** — Gate 2 uses `eval/smoke-manifest.json` (small curated set). Gate 4 uses full golden + comprehension sequences. |
| D3 | **Candidates from fixtures first** — smoke can score checked-in `eval/baselines/*.candidate.json` + M2 capture texts without regenerating; optional `--generate` later. |
| D4 | **Judge input** — case JSON + candidate text + rubric excerpt; judge returns structured JSON matching rubric dimensions; invalid JSON = trial fail, not silent pass. |
| D5 | **Separate judge model** — config rejects judge model id equal to generator model id when both set. |
| D6 | **Significance** — binary dimensions: two-proportion z-test vs trailing baseline rates; continuous (if any): Welch’s t-test. Blocking uses tolerance band + significance, not a single absolute cutoff. |
| D7 | **Quarantine** — `eval/smoke-quarantine.json` lists case ids excluded from merge-blocking; still reported. |
| D8 | **No capture mutation** — M2 attempt history stays immutable; M3 does not rewrite attempts to pass. |
| D9 | **Secrets** — `JUDGE_API_KEY` (or provider-specific) only via env / GitHub Actions secret; never committed. |

### Pipeline

```
golden / smoke-manifest
        │
        ▼
 Layer 1 checkers + golden-turn evaluator ── fail → exit non-zero
        │ pass
        ▼
 dry-run? ──yes──► artifact (judge_skipped) → exit 0
        │ no
        ▼
 N trials × pinned judge (temp 0)
        │
        ▼
 aggregate (raw dimensions + significance vs baseline)
        │
        ▼
 Gate 3 token-overhead (when captures present)
        │
        ▼
 exit 0 / 1 + artifacts
```

### CI dual path

1. **Always**: existing build/test/golden/dist-sync + `npm run eval:smoke -- --dry-run`.
2. **When `secrets.JUDGE_API_KEY` is non-empty**: additional step/job runs live smoke; failure blocks merge.
3. **Path filter** (live/expensive only): prompts, `skill/`, `src/checkers*`, `src/*eval*`, `src/profile*`, `eval/`, related workflows.
4. Unrelated PRs skip live judge spend; dry-run still cheap.

### Reuse (do not rewrite)

- `src/checkers.ts`, `src/comprehension-gate-checker.ts`
- `src/golden-turn-evaluator.ts`, `src/golden-schema.ts`
- `src/token-overhead.ts` (ceilings, pairing, report)
- `eval/rubric.md`, `eval/comprehension-rubric.md`
- Patterns from `eval/runtime/evaluate-m2.ts` (thresholds, report shapes) — extract shared bits only when duplication hits 3+

## 4. Testing Strategy (before / with impl)

Eval-before-behavior: tests and fixtures for the runner land before (or in the same PR as) the behavior they gate — never after “greenwashing.”

1. **Unit**: aggregate math (pass rates, quarantine exclusion, significance edge cases with fixed tables).
2. **Unit**: dry-run produces `judge_skipped` and never calls network (inject failing client).
3. **Unit**: judge response schema validation (missing dimension → fail).
4. **Fixture smoke**: small golden subset + frozen candidate strings → Layer 1 + mocked judge → expected artifact.
5. **Doc-sync**: `eval/README.md` links runner + quiz protocol once those files exist.
6. **CI contract test** (optional lightweight): workflow YAML contains dry-run step and conditional secret check string.

No weakening of golden hashes or M2 captures to pass.

## 5. Implementation Steps

Ordered; each step should be one focused PR when possible.

1. **Plan + stack map** — this doc; link from `eval/README.md` under “M3 (planned)”.
2. **Smoke manifest + quarantine files** — curated ids; schema tests.
3. **`eval-aggregate` + artifact types** — pure TS, no network; tests with fixed tables.
4. **`judge-client` interface + mock** — live HTTP adapter behind flag; pin fields required.
5. **`eval-runner` CLI** — Layer 1 → dry-run/live → artifacts; `package.json` script.
6. **Wire Gate 3** — call `buildTokenOverheadReport` from runner/CI; flip from report-only when multi-trial policy met (document interim).
7. **CI dual path** — dry-run always; live when secret present; path filters on expensive job.
8. **Quiz protocol** — `eval/quiz/README.md` (+ minimal score sheet template).
9. **Nightly warn workflow** — full suite schedule / `workflow_dispatch`; does not block PRs.
10. **Docs sync** — AGENTS “aspirational” → real when live check exists; README roadmap honesty pass only with user OK (M2 status language still sensitive).

## 6. Rollout Plan

1. Land steps 1–5 on a `feat/m3-eval-runner` branch; local dry-run required for merge of early PRs.
2. Add repo secret when ready; flip live smoke without code fork (same CLI).
3. Re-baseline judge: change of `JUDGE_MODEL_VERSION` requires documented PR + fresh baseline rates (see `eval/rubric.md` re-baselining section).
4. Rollback: revert runner/CI; Layer 1 gates remain. Quarantine is not a silent delete of cases.

## 7. Open product debt (explicit, not this plan’s blocker)

- M2 automated runtime thresholds still FAIL (attempt 13); acceptance open.
- Prefer `openai-codex` for any future recapture; no Cursor forbid-list churn unless asked.
- Large `eval/runtime/m2/attempts/` tree may later be gitignored or slimmed — separate chore.

## 8. Rollback

M3 is infrastructure-only until CI live smoke is enabled. Disabling the secret returns CI to dry-run. Removing workflows restores pre-M3 PR surface. Golden dataset and rubrics remain the source of “pass”; the runner must not redefine them post-hoc.
