# m1 implementation plan — profile + language rules

Revision 3 — post round-3 interrogation (reports: `docs/plans/reviews/round3-fable.md`, `round3-sol.md`).

## 1. Overview

**Problem**: LLM responses default to jargon-dense, assumption-heavy explanations. im-dumb needs its foundation: a personalized communication profile, the STE-inspired language rule layer that applies it, and the eval scaffolding that must exist before those rules ship (prd.md §9, AGENTS.md invariant 7).

**Approach**: Ship the skill as a prompt-driven `SKILL.md` package whose language rules are applied by the model at generation time — one-shot, no rewrite loop (ADR-001) — backed by small dependency-free TypeScript-compiled scripts for the deterministic parts: profile load/validate/save and constraint checking. Deterministic checkers are written once and reused as both eval Layer 1 and the CI gate.

**In scope (M1)**:
- Repo scaffolding (TypeScript build, zero runtime deps, `node:test`)
- Profile schema + validator + profile CLI
- `skill/im-dumb/SKILL.md` v0.1.0: onboarding flow, language rules, ADHD mode, output shape, conflict precedence
- Deterministic constraint checkers (eval Layer 1)
- Golden dataset draft (M1 categories) + judge rubric draft (non-redundant dimensions, no ELO)
- Baseline + candidate response capture; token-overhead measurement (no LLM calls in CI)
- CI: minimal from first PR, completed at step 10

**Out of scope (M1)**: comprehension gate (M2), LLM judge runner / Layer 2+ execution (M3), installer + multi-harness packaging (M4), learning assets (M5), release workflow + hosted publishing (M6), hosted-harness (no-filesystem) profile transport (M4-entry decision; `IM_DUMB_PROFILE` is the hook). Gate 3 (token budget) CI enforcement deferred to M3 when the eval runner lands — provisional ceilings recorded now (D12). Path filtering, audited override wiring, and spend alerting from prd.md §9.9–9.10 deferred with the same per-milestone reading recorded in AGENTS.md invariant 7 — deliberate, not drift.

## 2. Requirements

### Functional
- FR1: Onboarding flow (instructions in SKILL.md) produces a structured profile via the profile CLI — never free-form notes, never raw-written JSON — except the documented no-script fallback (step 7): when script execution is unavailable, the model emits schema-shaped JSON with the exact save path and instructs the user to run `validate` when a shell is next available.
- FR2: Profile persisted as JSON at `~/.im-dumb/profile.json` (or `IM_DUMB_PROFILE` path); schema per §3.
- FR3: Profile CLI validates on load. Missing/unparseable file → skill offers onboarding. Invalid *value* of a known field → warn + per-field default (one bad enum never torches the profile). Unknown fields: reject on save, warn-ignore on load. Missing known fields: documented default + warn. Invalid `IM_DUMB_PROFILE` path or unsupported `schema_version` → hard error, never onboard over it.
- FR4: Language rules in SKILL.md encode prd.md §5.3: common words first, define-on-first-use, one term per concept, active voice, ~20-word prose sentence cap, one topic per paragraph, no filler/hype/hedging, no unexplained acronyms, no stacked qualifiers in one sentence.
- FR5: ADHD mode restructures (per D10 definition), not merely shortens (prd.md §5.4).
- FR6: Default output shape: `**Answer**` → `**Why**` → `**Steps**` → `**Example**` markers (D9, with D9 exemptions); plain + technical dual output for complex topics (trigger heuristics named in SKILL.md: ≥3 new terms needing definition, multi-step causal chain, or decision with trade-offs), nested inside the outer marker sequence with `Plain:`/`Technical:` labels.
- FR7: Deterministic checkers verify, from text input: prose sentence cap, forbidden phrases, one-term-one-concept, output-shape markers (D9), ADHD structure heuristics (warn), SKILL.md frontmatter + body size, profile JSON validity, golden case-file validity.
- FR8: Token-overhead script computes per-case and aggregate overhead % of captured candidate responses vs captured baselines (both from step 7b) against D12 ceilings, using the D6 formula.

### Non-functional
- NFR1: No outbound network calls from any bundled script (invariant 2). Response capture (7b) uses a model, manually, outside CI and outside `skill/`.
- NFR2: Compiled `dist/` JS runs on bare Node ≥24 — zero runtime deps (invariant 3). ESM (`"type": "module"`). Dev/test workflow needs ≥24.12 (stable type stripping); `engines` stays `>=24`.
- NFR3: `SKILL.md` `name: im-dumb` matches directory; `description` < 1024 chars, states what + when (invariants 1, 4).
- NFR4: `metadata.version: 0.1.0`; strict SemVer from here (invariant 5).
- NFR5: Flesch-Kincaid or similar scores, if computed, are labeled supporting-signal-only (invariant 7).

### Acceptance criteria
- `npm run build && npm test` green; CI runs `node dist/check-cli.js` from a directory with no `node_modules` (dep-free smoke).
- Checker CLI: exit 0 on compliant fixture, exit 1 per violating fixture (errors only drive exit code), exit 2 on bad invocation.
- Profile CLI: `load|validate|save` round-trip green including warn paths and typed-error paths (FR3 matrix, D15 contract).
- SKILL.md passes structural Layer 1 blocking (frontmatter validity, name sync, description length); body-size budget reported warn-only per D12.
- Golden dataset: covers §9.4 categories 1, 2, 3, 6; every case passes the case-schema validator; ADHD pairs satisfy the D14 pair invariant; manifest verified in CI.
- Baselines + candidates captured for every golden case with complete metadata (model id/version, date, settings, skill version, trial count, dataset hash).
- Token-overhead report runs over captured pairs; aggregate and per-case numbers reported against D12 provisional ceilings (report-only in M1).
- Rubric exists with 3 separable dimensions, pass/fail per dimension, judge pinning (separate from production model) + re-baselining + rubric-adherence audit sections, no ELO.
- Manual spot-check protocol executed: N=5 named golden cases through a live model with skill loaded; results table in the step-7 PR description.
- CI blocks on: bad PR title, typecheck failure, test failure, Layer 1 errors, dist-sync drift, golden manifest drift.
- Step 11 doc-sync complete: README + AGENTS.md layout updated.

### Traceability matrix (behavior → enforcement)
| Behavior | M1 enforcement | M3+ |
|---|---|---|
| Sentence cap | checker (error on fixtures) | judge |
| Forbidden phrases (built-in lexicon ∪ profile) | checker (error) | judge |
| One term per concept | checker (lexical, error) | judge (semantic) |
| Output-shape markers | checker (error when `answer-first`, D9 exemptions apply) | judge |
| ADHD structure (D10) | checker heuristics (warn) + golden pairs + spot-check | judge |
| Vocabulary level, define-on-first-use, active voice, topic-per-paragraph, acronyms, stacked qualifiers, tone | golden annotations + manual spot-check protocol | judge |
| Dual plain/technical output | spot-check | judge |
| Profile schema validity | profile CLI + checker (error) | — |
| Token overhead | FR8 report vs D12 ceilings | Gate 3 blocking |

## 3. Technical Design

### Layout (extends AGENTS.md target layout; step 11 updates AGENTS.md)
```
skill/im-dumb/
  SKILL.md              # frontmatter + rules + onboarding + ADHD + shape + precedence
  scripts/profile.js    # compiled profile CLI (only bundled script, single artifact)
  references/           # optional overflow (onboarding detail) if body budget tight
src/
  profile.ts            # single self-contained module: types, defaults, validate/load/save
                        #   + CLI entry behind direct-execution guard (D15)
  checkers.ts           # deterministic constraint checks (pure functions) + tuning constants
  check-cli.ts          # CLI wrapper: file/stdin in, violations out, exit code
  golden-schema.ts      # hand-rolled golden case validator (no ajv)
  token-overhead.ts     # baseline vs candidate overhead computation
  data/lexicon.ts       # built-in filler lexicon + synonym sets (reviewed like golden data)
eval/
  golden/               # dataset JSON + README.md (category mapping, case schema, manifest)
  rubric.md             # judge rubric draft + provisional ceilings + re-baselining + audits
  baselines/            # captured baseline AND candidate responses + README.md
test/                   # node:test suites + fixtures/
.github/workflows/ci.yml
package.json  tsconfig.json
```

### Decisions
- **D1 — JSON profile, not YAML**: `JSON.parse` is stdlib. Single global path `~/.im-dumb/profile.json`.
- **D2 — prompt-driven rules** (ADR-001): model applies rules at generation time, one shot; scripts never touch the response path.
- **D3 — checkers are pure functions** over `(text, profile)` returning `Violation[]` (`severity: error|warn`). Sentence cap comes from `profile.sentence_length_cap`; tuning values (default cap, >10% threshold) are exported typed constants in `src/checkers.ts` — no config file (add one only if M3 proves runtime configuration needed). The eval dispatcher selects which checks run per case from `expected_checks` — checkers never guess prompt intent.
- **D4 — one compiled script committed**: `skill/im-dumb/scripts/profile.js` only (skill installable without build step). Single artifact guaranteed by D15's one-module design — plain `tsc`, no bundler. Checkers/measurement stay repo-side. `src/` is source of truth; CI rebuild+diff enforces sync. Exact-pinned `typescript` (`"6.0.3"`), `.gitattributes` LF, toolchain bumps regenerate `scripts/` in the same PR.
- **D5 — one-term-one-concept is lexical and conservative**: curated synonym sets in `src/data/lexicon.ts`, changes reviewed like golden data. Semantic drift → judge layer.
- **D6 — token counting**: `chars/4` over Unicode code points, fractional values retained, labeled approximate. Aggregate = `(sum(candidate_chars) / sum(baseline_chars) − 1) × 100`; per-case same formula per pair; zero-character baseline = invalid pair, hard error. Comparisons relative, ±~10% method error acknowledged. Single-run captures are noisy — not M3 ground truth.
- **D7 — sentence cap applies to prose sentences**: split via `Intl.Segmenter('en', {granularity: 'sentence'})`; excluded: fenced/inline code, blockquotes, headings. Reports count + top-5 offenders; >10% of sentences over cap = error (threshold tunable, PATCH).
- **D8 — self-check severity split**: structural checks block on SKILL.md; language checks block on fixtures, warn-only on SKILL.md (mention-vs-use). `--skill-doc` CLI mode.
- **D9 — output-shape markers**: when `output_shape: answer-first`, SKILL.md mandates bold section markers `**Answer**`, `**Why**`, `**Steps**`, `**Example**` in that order (Steps/Example omitted when inapplicable — Answer + Why present for non-exempt responses). Marker = exact full-line match, exactly once, outside code fences/quotes; one outer sequence per response; dual output nests inside as `Plain:`/`Technical:` labels. **Exemptions**: (a) simple answers per the D10 definition (single paragraph, ≤3 sentences) skip markers; checker skips shape check below that threshold; (b) explicit user machine-format requests (exact JSON, code-only, etc.) outrank skill shape (D11) and skip the shape check. `narrative` = no markers, no shape check. Marker cost ~8 tokens, measured by FR8.
- **D10 — ADHD compliance definition**: simple answers (single paragraph, ≤3 sentences) exempt. Otherwise: direct answer first, headed segments, ≤3 sibling items per list/segment. Checker accepts markdown headings **or** bold-line markers (including D9 markers) as segment heads — when both modes active, D9 markers satisfy D10. Warn-severity heuristics; judge owns the rest at M3.
- **D11 — conflict precedence** (documented in SKILL.md, stabilizes golden answers): explicit user output contract (exact format/machine-readable) → factual fidelity/safety → forbidden phrases → ADHD structure → output shape → tone. `adhd_mode: true` overrides `output_shape: narrative`.
- **D12 — provisional token-overhead ceilings** (recorded in `eval/rubric.md`, PATCH to recalibrate): corpus aggregate ≤ +30% vs baselines; per-case ≤ +60%. Report-only in M1; Gate 3 blocks at M3. SKILL.md body budget: **warn** >1000 words (never blocks; drafting target ≤900) — the skill's own context cost is the dominant M1 overhead. Overflow escape hatch: move onboarding detail to `references/onboarding.md` (progressive disclosure), never compress the rules.
- **D13 — frontmatter parsing**: hand-rolled parser for the exact subset the skill emits (flat `key: value` + one-level `metadata:` map). Documented as a subset, not general YAML.
- **D14 — golden case schema** (hand-rolled validator, no ajv): `{ id, category, prompt, profile, reference_facts[], must_preserve[], expected_checks: [{checker, expect}], pair_id? }`. Normative details live in `eval/golden/README.md`: `category` enum = `persona-baseline | jargon-decomposition | adhd-pair | adversarial`; `checker` enum = the FR7 checker ids; `expect` = `pass | fail | warn`; `reference_facts`/`must_preserve` = string arrays (≤20 × ≤200 chars); **pair invariant** — a `pair_id` names exactly two cases with identical `prompt` and `profile` except `adhd_mode`; case `id` stable, never reused. Manifest: `eval/golden/manifest.json` — sorted case ids + per-file SHA-256; generator script + CI drift verification. Schema versioned in the README; **v2 at M2 adds `turns[]` for categories 4–5 — single-`prompt` v1 cases remain valid, manifest hashing unchanged**. Edits to existing case files require explicit reviewer sign-off noted in the PR (a gate weakened by editing its cases is the failure prd §9.4 warns about).
- **D15 — profile module/CLI single-artifact design**: `src/profile.ts` is one self-contained module — types, defaults, `validate()`, `load()`, `save()` exported for tests, plus CLI entry (`load|validate|save`) behind a direct-execution guard (`process.argv[1]` vs `import.meta.url`). Plain `tsc` emits one file → copied to `skill/im-dumb/scripts/profile.js`. No bundler, no cross-file imports in the bundled artifact. **Stream contract**: stdout = JSON only; stderr = human warnings. **Exit contract**: `load` → exit 0 + `{profile, warnings[]}` when usable (defaults applied as needed); exit 1 + `{error: "missing" | "unparseable" | "env-path-invalid" | "unsupported-schema-version"}`; exit 2 = usage error. SKILL.md branches on these: `missing`/`unparseable` → offer onboarding; `env-path-invalid`/`unsupported-schema-version` → surface error, never onboard over it. `save` validates (reject unknown fields, D15 bounds), writes atomically (tmp + rename), creates `~/.im-dumb/` if missing. **Edit paths (scripted and fallback) are load-modify-save: hidden fields (`known_gap_types`, `schema_version`) pass through unchanged — M2's learned state survives M1 edits.**

### Profile schema (v1) — normative field table
| Field | Type | Default | Bounds / policy |
|---|---|---|---|
| `schema_version` | int | 1 | above supported → load error `unsupported-schema-version` |
| `vocabulary_level` | enum | `common` | `common \| technical-ok \| expert` |
| `jargon_policy` | enum | `define-on-first-use` | `define-on-first-use \| avoid \| allow` |
| `sentence_length_cap` | int | 20 | 5–60; out-of-range/non-int → default + warn |
| `paragraph_topic_limit` | int | 1 | 1–3; out-of-range → default + warn |
| `tone` | enum | `direct` | `direct \| friendly \| neutral` |
| `output_shape` | enum | `answer-first` | `answer-first \| narrative` |
| `adhd_mode` | bool | `false` | non-bool → default + warn |
| `known_gap_types` | array | `[]` | items `{type: string ≤40 chars, confidence: number 0–1}`; M1 writes `[]`, M2 populates; hidden from onboarding; preserved on edit (D15) |
| `forbidden_phrases` | string[] | `[]` | ≤50 items × ≤40 chars |
| `learning_asset_preferences.formats` | enum[] | `["markdown","html"]` | items `markdown \| html` |

- All strings: printable characters only, no control chars except newline-free; caps above are hard save-rejects, load applies default + warn. Profile is injected into model context every invocation (prompt-injection surface).
- Unknown fields: reject on save, warn-ignore on load. Missing known fields: default + warn. Only unparseable/missing file triggers onboarding offer.
- `IM_DUMB_PROFILE` = filesystem path only. When set: load AND save use it; unreadable/invalid path = hard error (no silent fallthrough).

## 4. Implementation Steps

Ordered (topological); each independently verifiable; TDD throughout.

1. **Scaffolding + minimal CI** — `package.json` (name `im-dumb`, `0.1.0`, `"type": "module"`, `engines: ">=24"`, `typescript` `"6.0.3"` exact devDep only; single package), `tsconfig.json` (strict, `target: es2023`, `module`/`moduleResolution: nodenext`, `erasableSyntaxOnly: true`, **`rewriteRelativeImportExtensions: true`** — `.ts` relative imports run directly under `node --test` AND emit correct `.js` in `dist/`, one import strategy for both paths, outDir `dist/`), tests `node --test 'test/**/*.test.ts'` (needs Node ≥24.12 locally; `tsc --noEmit` = typecheck gate), `.gitignore`, `.gitattributes` (LF). Minimal CI from first PR: title lint (pull_request events only) + build/typecheck + test. Manual bootstrap (repo settings, documented in PR): branch protection, required status contexts, override label + second-approver rule per AGENTS.md. Verify: green on empty suite. *Low.*
2. **Profile module + CLI** (`src/profile.ts`, D15 single module) — types, defaults, `validate()`, `load()`, `save()`, CLI entry per D15 stream/exit contract. Tests: FR3 matrix (valid/invalid-value/missing-field/unknown-field/missing-file/unparseable/future-schema_version/env-override-invalid/bounds table row per field/hidden-field preservation on edit). *Medium. Depends: 1.*
3. **Deterministic checkers** (`src/checkers.ts`, `src/data/lexicon.ts`, `src/golden-schema.ts`) — D7 sentence cap (Intl.Segmenter), forbidden phrases (built-in filler lexicon ∪ `profile.forbidden_phrases`, word-boundary, case-insensitive), one-term-one-concept (D5), output-shape markers (D9 incl. exemptions, exactly-once, outside-code rules), ADHD heuristics (D10 incl. marker-as-heading), frontmatter subset checks (D13: name sync, description <1024, required fields, body word budget warn per D12), golden case validator (D14 incl. pair invariant), manifest generator + verifier. Tuning constants exported per D3. Tests: violating/compliant fixture pairs per checker; segmentation edges (abbreviations, links, lists, empty prose); marker edge cases (duplicate markers, markers inside code fences, simple-answer exemption threshold). *Medium-high. Depends: 2.*
4. **Checker CLI** (`src/check-cli.ts`) — stdin/file input, `--profile`, `--skill-doc` (D8 downgrade), JSON/human output, exit codes per acceptance. *Low. Depends: 3.*
5. **Golden dataset draft** (`eval/golden/`) — §9.4 categories 1, 2, 3, 6 (4–5 → M2 start): persona baselines ×3, jargon decomposition, ADHD pairs (D14 pair invariant), adversarial jargon-leakage/unsafe-oversimplification. 25–30 cases per D14 schema, validated by step-3 validator; manifest generated + committed. `eval/golden/README.md`: category mapping, full case schema (D14 normative details), schema-v2 `turns[]` forward note, edit-review rule. *Medium. Depends: 3. Blocks: 7.*
6. **Judge rubric draft** (`eval/rubric.md`) — dimensions: factual fidelity, constraint compliance, reader-follow-up-need (judge enumerates concrete blocking questions; pass = zero). Pass/fail per dimension, raw per-dimension reporting, judge model pinned by version @ temp 0 **and separate from the production model** (prd §9.6 self-preference), periodic rubric-adherence audit cadence, re-baselining process, D12 provisional ceilings recorded, ELO excluded. *Low. Parallel with 5.*
7. **SKILL.md v0.1.0** — frontmatter (`name: im-dumb`, description <1024 what+when, `metadata.version: 0.1.0`); body (target ≤900 words, warn >1000; overflow → `references/onboarding.md`): profile load via `scripts/profile.js load` with D15 exit-code branching (`missing`/`unparseable` → offer onboarding; `env-path-invalid`/`unsupported-schema-version` → surface error) — never raw-read; `IM_DUMB_PROFILE` documented; onboarding flow (one question per visible §3 field; hidden: `schema_version`, `known_gap_types`; default on skip; confirm summary before `save`; re-run = load-modify-save preserving hidden fields; no-script fallback per FR1); language rules (FR4); ADHD mode (D10); output shape + markers + exemptions (D9); dual-output triggers + nesting (FR6); conflict precedence (D11); manual invocation fallback (`/im-dumb`, `/skill:im-dumb`). Verify: structural Layer 1 blocking + language warns reviewed; spot-check protocol: 5 named golden cases, live model, results table in PR description. *High. Depends: 3, 5.*
7b. **Response capture** (`eval/baselines/`) — for each golden case, manually capture (outside CI): one **baseline** (no skill) and one **candidate** (skill loaded, case profile applied), same model + settings, linked by case id. **Mechanism documented in `eval/baselines/README.md`**: harness used; skill loaded by manual copy to `~/.claude/skills/im-dumb/` (pre-installer); case profile applied by writing it to a temp file + `IM_DUMB_PROFILE`; one capture per case. Machine-readable capture shape (JSON): `{case_id, kind: baseline|candidate, model_id, model_version, date, settings, skill_version, trial_count: 1, dataset_hash, response}`. Single-run = noisy; acknowledged, not M3 ground truth. *Low-medium. Depends: 5 (baselines), 7 (candidates).*
8. **Token-overhead script** (`src/token-overhead.ts`) — reads capture pairs from `eval/baselines/`, per-case + aggregate % per D6 formula vs D12 ceilings, report-only; zero-baseline pair = error. Tests: fixture math incl. unicode code-point edges, fractional retention, zero-baseline rejection. Unit implementation after step 1; milestone verification needs 7b data. *Low. Depends: 1 (code), 7b (report).*
9. **Build sync** — build emits `dist/profile.js` (single artifact per D15) → copied to `skill/im-dumb/scripts/profile.js`; CI rebuild+diff (D4). *Low. Depends: 2.*
10. **CI completion** — adds: Layer 1 (checker CLI vs SKILL.md `--skill-doc` + fixtures; golden validation + manifest drift; dep-free dist smoke from empty dir), dist-sync diff. Full list: title lint (`amannn/action-semantic-pull-request@v6`), build+typecheck, `npm test`, Layer 1, dist-sync. `actions/checkout@v7`, `actions/setup-node@v6`, matrix 24.x + 26.x. No path filtering in M1 (recorded deferral: filters/override-wiring/spend-alerting start with expensive gates at M3 — prd §9.9 per-milestone reading, AGENTS.md invariant 7). *Low-medium. Depends: 4, 5, 7, 9.*
11. **Doc sync pass** — README: profile location + onboarding + `IM_DUMB_PROFILE`, "vocabulary level" wording, security-section npx qualification, installer sections labeled planned-M4; AGENTS.md: repo-layout block updated to actual layout. *Low. Depends: 7, 10.*

## 5. Testing Strategy

- **Unit** (`node:test`): FR3/D15 profile matrix incl. hidden-field preservation; per-checker fixture pairs; golden validator + pair invariant + manifest verifier; token-overhead math (D6 formula); both CLIs' stream/exit contracts.
- **Fixtures**: `test/fixtures/` — minimal texts per constraint; SKILL.md is itself the structural-check fixture.
- **Edge cases**: code/quote/heading exclusion; abbreviations ("e.g.", "v1.2") in sentence splitting; empty profile file; future `schema_version`; invalid `IM_DUMB_PROFILE`; unicode code points in chars/4; forbidden-phrase word boundaries; ADHD simple-answer exemption; D9 exemptions (simple answer, machine-format); duplicate markers; markers-in-code-block false positive; zero-baseline pair.
- **Self-check (D8)**: structural blocking on SKILL.md permanently; language warn-only there; body budget warn-only (D12).
- **Dep-free smoke**: CI executes `node dist/check-cli.js` from a temp dir with no `node_modules`.
- **Deferred**: judge execution, multi-turn gate sequences, human quizzes → M2/M3 (per-milestone reading, AGENTS.md invariant 7). M2 plan must open with dataset categories 4–5 (schema v2 `turns[]`) + gate eval scaffolds.

## 6. Rollout Plan

- No users; no migration. `schema_version: 1` + reserved `known_gap_types` shape + D15 hidden-field preservation are the M2 hooks.
- CI gates from first PR (step 1); Conventional Commit titles throughout; branch protection configured manually at step 1.
- Rollback = git revert; nothing published in M1.
- Exit: all §2 acceptance criteria met (traceability matrix satisfied for M1 column); M2 starts with dataset, rubric, checkers, reserved schema, and preserved-state contract in place.
