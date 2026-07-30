# Round 2 interrogation report — M1 profile and language rules

Sources reviewed: `docs/plans/m1-profile-and-language-rules.md`, `prd.md`, `AGENTS.md`, `README.md`, `CLAUDE.md`, `docs/adr/adr-001-prompt-driven-rule-layer.md`, and both interrogation skill definitions. Root `plan.md` and `progress.md` do not exist. There is no `CONTEXT.md` and no source code.

## Review

### Integration audit of the 14 resolved decisions

| # | Result | Evidence / required correction |
|---|---|---|
| 1 | **Incomplete** | The architecture is one-shot in the plan and ADR, but `prd.md:1-24`, `AGENTS.md:3`, and `README.md:3` still call the product a response “rewriter.” That conflicts with ADR-001’s rejection of post-generation rewriting (`docs/adr/adr-001-prompt-driven-rule-layer.md:7-23`). Replace those summaries with “shapes responses at generation time.” |
| 2 | **Incomplete** | Step 5b has the resolved manual capture and metadata (`docs/plans/m1-profile-and-language-rules.md:104`), but M1 acceptance never requires the baseline corpus or metadata to exist (`:39-44`). M1 can therefore satisfy its written exit criteria while skipping 5b. Add a baseline-completeness acceptance item. |
| 3 | **Integrated** | The structural/error versus language/warn split is consistent in D8, steps 3–4, acceptance, and testing (`docs/plans/m1-profile-and-language-rules.md:41-42,74,101-102,117`). |
| 4 | **Integrated via erratum, but still locally contradictory** | `AGENTS.md:15` records the per-milestone interpretation and M3 Layer-2 deferral. The plan follows it (`docs/plans/m1-profile-and-language-rules.md:18,103,118`). However, `prd.md:454-479` still reads as an unconditional path-filtered/Layer-2/pre-code contract; add a cross-reference there to the per-milestone policy instead of relying on readers to discover `AGENTS.md`. |
| 5 | **Integrated, underspecified** | Reject-on-save/warn-ignore-on-load is present (`docs/plans/m1-profile-and-language-rules.md:93,100`). Behavior for missing known fields, unsupported `schema_version`, and how warnings are returned remains undefined. |
| 6 | **Incomplete** | D7 says every prose sentence outside code blocks and blockquotes (`docs/plans/m1-profile-and-language-rules.md:75`), but FR4 still says “instructional sentence” (`:26`) and the PRD retains the narrower wording (`prd.md:261-269`). Align the requirement text with D7 and identify inline code, headings, lists, and HTML behavior. |
| 7 | **Not documented where users need it** | The override is first in step 2 (`docs/plans/m1-profile-and-language-rules.md:100`), but neither README usage nor step 11’s README checklist mentions `IM_DUMB_PROFILE` (`README.md:18-44`; plan `:110`). Step 7 also says only “profile location + load instruction” (`:106`). Name the override and its semantics in SKILL.md and README acceptance. |
| 8 | **Contradictory** | Step 9 says only profile JS ships (`docs/plans/m1-profile-and-language-rules.md:108`), but D4 says compiled `scripts/` are synced with `src/` (`:71`), the overview groups profile and checker scripts together (`:7`), and ADR-001 says bundled scripts check text in CI/evals (`docs/adr/adr-001-prompt-driven-rule-layer.md:11-14`). Amend D4/ADR-001 to say only the executable profile CLI is bundled; checkers and measurement remain repository-side. |
| 9 | **Integrated** | Step 1 explicitly chooses one package (`docs/plans/m1-profile-and-language-rules.md:99`). |
| 10 | **Integrated** | Minimal CI begins in step 1 and is completed in step 10 (`docs/plans/m1-profile-and-language-rules.md:99,109,123`). |
| 11 | **Partially integrated** | The tone enum and generic cap/charset promise exist (`docs/plans/m1-profile-and-language-rules.md:85,93`), but no actual cap values, normalization, allowed characters, or nested-array limits are specified. Step 2 cannot write deterministic boundary tests from this contract. |
| 12 | **Integrated** | Step 5 maps categories 1, 2, 3, and 6, defers 4–5 to M2, and requires schema validation (`docs/plans/m1-profile-and-language-rules.md:103`; `AGENTS.md:15`). |
| 13 | **Internally inconsistent** | `~6.0.3` is not an exact pin despite being called one (`docs/plans/m1-profile-and-language-rules.md:99`); use `6.0.3`. The package supports all Node `>=24` (`:34,99`) while the same step says its test strategy depends on Node `>=24.12`; either raise `engines` to `>=24.12` or stop claiming the earlier minors are supported. |
| 14 | **Integrated** | `AGENTS.md:43` and `prd.md:629-640` now say all five gates. |

### Blocking findings

- **Blocker — the v1 profile schema is not implementable or M2-compatible.** The example uses pipe-delimited pseudo-values rather than a normative schema and omits required/optional status, numeric ranges, array limits, defaults, normalization, and precise string caps (`docs/plans/m1-profile-and-language-rules.md:77-93`). More seriously, `known_gap_types: []` has no item shape, while tapering requires stored confidence (`prd.md:309-316,435-441`). Shipping it as `string[]` in M1 and changing it to confidence-bearing objects in M2 would be a breaking schema change under `prd.md:605-612`.

- **Blocker — the profile script has no runnable interface.** The layout contains only `src/profile.ts` with library functions (`docs/plans/m1-profile-and-language-rules.md:53-57`), while onboarding promises “questions → JSON profile via script” (`:106`) and step 9 copies “profile JS” (`:108`). No CLI entry point, commands, stdin/stdout contract, exit codes, target path, atomic-write behavior, or no-shell fallback is specified. A model cannot reliably invoke an unspecified module.

- **Blocker — `IM_DUMB_PROFILE` has no defined value or failure semantics.** Step 2 does not say whether it contains a path or inline JSON, whether save writes to the override, or whether an unreadable/invalid explicit override falls through to the home profile (`docs/plans/m1-profile-and-language-rules.md:100`). Silent fallback would hide operator error; inline JSON would create quoting and leakage problems.

- **Blocker — the token-overhead flow has no candidate artifacts and no gate.** Step 5b captures only unmodified baselines (`docs/plans/m1-profile-and-language-rules.md:104`). Step 8 nevertheless expects baseline/candidate pairs in `eval/baselines/` (`:107`). No step captures profile-applied one-shot candidates, no schema links a candidate to the exact prompt/profile/baseline, no aggregate definition exists, and no ceiling appears in acceptance or CI (`:39-44,109`). This does not implement the enforced ceiling required by `prd.md:343-351,365-375`.

- **Blocker — the golden case contract cannot support its own rubric.** Step 5 specifies only `input`, `profile`, and “expected-constraint annotations” (`docs/plans/m1-profile-and-language-rules.md:103`). Factual-fidelity judging and unsafe-oversimplification cases need reference facts and must-preserve facts (`prd.md:390-398,423-430`). ADHD pairs need a stable pair ID. Baselines need stable case/prompt IDs. “JSON schema validated” also lacks a schema dialect and validator strategy. Drafting cases before those fields are fixed creates immediate migration work.

- **Blocker — M1 behaviors are not mapped to checks before they ship.** FR7 covers sentence length, phrases, synonyms, shape, and profile validity (`docs/plans/m1-profile-and-language-rules.md:29`), but FR4–FR6 also promise vocabulary selection, definition-on-first-use, active voice, paragraph topics, acronyms/qualifiers, tone, ADHD restructuring, and plain/technical dual output (`:26-28`). The only behavioral verification before M3 is an undefined manual “spot-check” (`:106`). `AGENTS.md:13` requires eval design before the behavior it gates. Add a requirement-to-enforcement matrix naming deterministic error, deterministic warning, golden annotation/manual protocol, or future judge rule for every behavior.

- **Blocker — SKILL.md conflict precedence is undefined.** `output_shape: narrative` conflicts with the global answer-first default; ADHD mode independently forces answer-first; dual plain/technical output can conflict with sentence/token limits; forbidden phrases can conflict with a necessary quoted term (`docs/plans/m1-profile-and-language-rules.md:81-90`; `prd.md:270-282`). Without a precedence table, golden answers and checker expectations cannot be stable.

### Step-level execution gaps and risks

- **High — field name semantics are inverted.** `vocabulary_floor` sounds like the minimum vocabulary complexity allowed, but the feature needs a maximum reader-comfort level (`prd.md:235-244`; plan `:81`). Rename it to `vocabulary_level` before it becomes persisted API, or define “floor” canonically. This is cheap only before M1.

- **High — onboarding is not a flow yet.** The plan does not define which fields are asked, whether questions are one-at-a-time, how defaults/skips work, whether future fields (`known_gap_types`, learning formats) are hidden defaults, whether the user confirms before save, or how an existing profile is edited (`docs/plans/m1-profile-and-language-rules.md:23,106`; `prd.md:235-248`). These choices directly determine SKILL.md instructions and fixtures.

- **High — ADHD mode is neither operationally defined nor checked.** “2–3 item chunks” could mean list size, section count, or all sibling concepts; “explicit boundaries” could mean headings, rules, or blank lines (`prd.md:270-276`). No ADHD checker appears in steps 3–4 (`docs/plans/m1-profile-and-language-rules.md:101-102`). Define a simple-response exemption and one structural convention before creating pairs.

- **High — deterministic parsing contracts are missing.** Sentence splitting/word counting is unspecified despite a hard 10% gate (`docs/plans/m1-profile-and-language-rules.md:75,116`). Use Node’s `Intl.Segmenter` and specify markdown exclusions. Frontmatter “validity” also requires either a defined YAML subset or a YAML parser; regexes do not establish YAML validity (`:101`; `prd.md:483-487`).

- **High — dependency-free execution is asserted, not tested.** Acceptance requires compiled JS to run without `node_modules` (`docs/plans/m1-profile-and-language-rules.md:40`), but CI only builds/tests/diffs (`:109`). Add an isolated packaged-artifact smoke test; running from the repository can accidentally resolve dev dependencies from ancestor `node_modules`.

- **High — CI cannot by itself make checks merge-blocking.** The plan creates workflows but has no repository-settings step for branch protection, required status contexts, or the label-plus-second-approver override claimed by `AGENTS.md:40-42` and `prd.md:617-628`. Record those as manual bootstrap settings or narrow M1’s claim. Also scope title lint to pull-request events; push events have no PR title.

- **Medium — the PRD and plan disagree on path filtering.** The plan deliberately runs all cheap M1 checks on every change (`docs/plans/m1-profile-and-language-rules.md:109`), while the source-of-truth PRD says evals run only for prompt/schema/eval diffs (`prd.md:454-457`). Record that path filtering starts when expensive M3 gates exist; otherwise both statements cannot remain normative.

- **Medium — baseline traceability is not reproducible enough.** “Dataset hash” does not define hash scope, canonicalization, or algorithm (`docs/plans/m1-profile-and-language-rules.md:104`). Use SHA-256 over a committed golden manifest and store prompt/case ID, generation settings, and response hash. Baselines shared by identical prompts should be referenced rather than recaptured per profile variant.

- **Medium — README describes unbuilt software as available.** M1 explicitly excludes the installer and multi-harness packaging (`docs/plans/m1-profile-and-language-rules.md:18`), but README gives an unconditional `npx im-dumb` install path and present-tense installer behavior (`README.md:18-44`). Mark it as roadmap/unpublished until M4. “Nothing is fetched-and-executed remotely” is also misleading because `npx` normally fetches and executes the npm package; say the installer performs no secondary remote fetch and the skill makes no invocation-time network calls (`README.md:24,48-50`).

- **Medium — source citations are unverifiable.** `prd.md` repeatedly cites `[1]`–`[6]` (for example `prd.md:111,494,534,552`) but contains no reference definitions or bibliography. This weakens the doc-backed harness and research claims.

- **Low — `CLAUDE.md` is correctly limited to the import.** No change required (`CLAUDE.md:1`).

## Question queue

Each row is one unresolved branch. Blocking order is highest first.

| # | Impact | Question | Recommended answer | Reason |
|---|---|---|---|---|
| Q1 | **Blocking** | What is one `known_gap_types` item in schema v1? | Reserve `{ "type": string, "confidence": number }` now; M1 writes `[]`, M2 owns updates. | PRD tapering requires confidence, and changing an already persisted array type would be breaking. |
| Q2 | **Blocking** | Does `vocabulary_floor` mean a reader level or a minimum required vocabulary? | Rename it to `vocabulary_level` with `common | technical-ok | expert`. | The current name implies the opposite of the product behavior. |
| Q3 | **Blocking** | How does a newer loader handle a profile missing a newly added known field? | Keep a small required core; apply documented defaults with warnings for later additive fields. | Unknown-field forward compatibility does not solve newer-reader/older-profile compatibility. |
| Q4 | **Blocking** | What exactly does `IM_DUMB_PROFILE` contain? | A filesystem path only; load and save use that path when set, and invalid explicit overrides return an error instead of silently falling through. | One meaning avoids quoting/secrets ambiguity and makes precedence observable. |
| Q5 | **Blocking** | What executable does SKILL.md invoke for profile operations? | Add `src/profile-cli.ts` with `load`, `validate`, and `save`; JSON on stdin/stdout, documented exit codes, atomic save, compiled to `skill/im-dumb/scripts/profile.js`. | A pure library module is not an onboarding interface. |
| Q6 | **Blocking** | Which rule wins when profile, ADHD, output-shape, and safety/fidelity constraints conflict? | Document: safety/factual fidelity → forbidden phrases → ADHD structure → selected output shape → tone; ADHD overrides `narrative`. | Stable precedence is required for prompts, cases, and checks. |
| Q7 | **Blocking** | What exact structure counts as ADHD-compliant? | Exempt a one-paragraph simple answer; otherwise require direct answer first, headed segments, and at most three sibling items per segment. | This is minimally visible, promptable, and deterministically testable. |
| Q8 | **Blocking** | What is the golden case-file schema and validator? | Use a versioned JSON Schema (Draft 2020-12) with stable ID, category, prompt, profile, reference facts, must-preserve/must-avoid facts, expected checks, and optional pair ID; validate with an eval-only dev dependency. | These fields are prerequisites for rubric execution, pairing, and artifact linkage. |
| Q9 | **Blocking** | Where do profile-applied candidate responses come from? | Add a manual post-SKILL capture step using the same model/settings as baseline capture, stored separately and linked by case ID. | Step 8 currently consumes artifacts no step creates. |
| Q10 | **Blocking** | What token-overhead statistic and ceiling blocks M1? | Set a provisional corpus-total ceiling plus a per-case outlier ceiling, record both in eval config, and make threshold recalibration a PATCH. | An average alone can hide one pathological response; no ceiling means no gate. |
| Q11 | **Blocking** | How is every FR4–FR6 behavior verified before SKILL.md ships? | Add a traceability table assigning each behavior to deterministic check, golden/manual checklist, or rubric criterion; make the documented manual checklist an acceptance artifact. | “Spot-check manually” has no reproducible pass condition. |
| Q12 | Non-blocking | How should prose sentences and words be segmented? | Use `Intl.Segmenter('en', ...)`; exclude fenced code, inline code, blockquotes, and headings, and test abbreviations, links, lists, and empty prose. | The hard 10% gate needs one reproducible counting rule without a dependency. |
| Q13 | Non-blocking | How should SKILL.md frontmatter validity be parsed? | Support and document the exact frontmatter subset the project emits, or use an eval-only YAML dev dependency. | Hand regexes cannot honestly claim general YAML validity. |
| Q14 | Non-blocking | Is README documenting current availability or the target product? | Label unimplemented M4/M6 commands and release claims as planned until those milestones land. | Present-tense installation instructions are false in a greenfield repository. |

## Verdict

**Not sign-off-ready.** The minimal plan changes required are:

1. Complete the normative profile contract, including `known_gap_types`, missing/future-version behavior, exact field limits/defaults, and `IM_DUMB_PROFILE` semantics.
2. Add a real profile CLI step and specify SKILL.md onboarding, fallback, conflict precedence, and ADHD compliance.
3. Define the golden case schema and a behavior-to-eval traceability matrix before step 7.
4. Add candidate capture, token statistics/ceilings, and baseline/candidate acceptance criteria.
5. Reconcile profile-only bundling across D4, ADR-001, layout, and CI; exact-pin TypeScript and align the Node floor.
6. Add isolated artifact smoke testing and manual branch-protection setup to CI steps.
7. Sync PRD/AGENTS/README wording for one-shot generation, M1 path-filter deferral, environment override, and current release status.

Residual risks after those edits: prompt-only compliance remains probabilistic by ADR-001; M1 still has no automated LLM judge by the accepted M3 deferral; profile persistence on hosted ephemeral harnesses remains an M4 design constraint.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "review-findings: blockers and notes cite docs/plans/m1-profile-and-language-rules.md, prd.md, AGENTS.md, README.md, CLAUDE.md, and ADR-001 by line; residual-risks are stated after the verdict"
    }
  ],
  "changedFiles": [
    ".pi-subagents/artifacts/outputs/7b7c0e7e/docs/plans/reviews/round2-sol.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short && git log --oneline -5 && git diff -- ...",
      "result": "failed",
      "summary": "Status showed only untracked files; git log failed because main has no commits. No staged files were reported."
    },
    {
      "command": "nl -ba prd.md | sed -n '230,680p' and line-numbered document inspection",
      "result": "passed",
      "summary": "Verified profile, eval, distribution, governance, and milestone requirements with line-level evidence."
    },
    {
      "command": "node acceptance-report JSON parse check (first quoting attempt)",
      "result": "failed",
      "summary": "Shell interpreted Markdown backticks; no files were changed."
    },
    {
      "command": "node acceptance-report JSON parse check && git diff --cached --quiet",
      "result": "passed",
      "summary": "Acceptance JSON parsed successfully and no staged files were present."
    }
  ],
  "validationOutput": [
    "All requested project documents were read fully; root plan.md and progress.md were absent.",
    "No source or tests exist; this was a greenfield documentation/plan review.",
    "Fourteen resolved Round-1 decisions were audited for cross-document integration."
  ],
  "residualRisks": [
    "Prompt-only language compliance remains probabilistic under ADR-001.",
    "Automated Layer-2 judge execution remains deferred to M3 by the accepted milestone policy.",
    "Hosted-harness profile persistence remains unresolved for M4."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added the requested Round-2 interrogation report only; no project source or planning documents were modified.",
  "reviewFindings": [
    "blocker: docs/plans/m1-profile-and-language-rules.md:77-93 - profile schema lacks a confidence-bearing known_gap_types shape and normative validation contract",
    "blocker: docs/plans/m1-profile-and-language-rules.md:53-57,106-108 - onboarding has no runnable profile CLI contract",
    "blocker: docs/plans/m1-profile-and-language-rules.md:104,107 - candidate response artifacts required by token-overhead measurement are never created",
    "blocker: docs/plans/m1-profile-and-language-rules.md:103 - golden schema lacks reference and linkage fields required by the rubric",
    "blocker: docs/plans/m1-profile-and-language-rules.md:26-29,106 - shipped behaviors lack a complete pre-implementation evaluation map",
    "high: docs/adr/adr-001-prompt-driven-rule-layer.md:11-14 conflicts with profile-only bundling in plan step 9",
    "high: README.md:3 and AGENTS.md:3 retain rewrite wording that conflicts with one-shot generation",
    "high: docs/plans/m1-profile-and-language-rules.md:99 calls a tilde range exact and supports Node minors below its stated test floor"
  ],
  "manualNotes": "No CONTEXT.md, root plan.md, or root progress.md exists. PRD citation markers [1]-[6] have no bibliography."
}
```
