# Round 3 interrogation report — M1 profile and language rules

Plan reviewed: `docs/plans/m1-profile-and-language-rules.md` Revision 2.

Sources read fully: `prd.md`, `AGENTS.md`, `README.md`, `CLAUDE.md`, `docs/adr/adr-001-prompt-driven-rule-layer.md`, both Round-2 reports, and the `interrogate-with-docs`/`interrogate` skill definitions. Root `plan.md` and `progress.md` do not exist. No `CONTEXT.md` or source code exists; this is a document-to-document greenfield review.

## Review

### A. Round-2 integration audit

| Resolution | Status | Evidence / residual |
|---|---|---|
| Profile CLI (`load\|validate\|save`, atomic save, only bundled script) | **Partial** | The commands, files, and atomic save landed (`docs/plans/m1-profile-and-language-rules.md:73-76,135,141-143`). The one-file artifact cannot be produced by the stated plain `tsc` build while `profile-cli.ts` imports `profile.ts`; see Blocker 1. stdout/stderr and exit-code meanings also remain undefined. |
| D9 fixed output markers | **Partial** | Exact markers and omission rules landed (`plan:30,100`). Their relation to dual output, exact-format/code-only requests, D10 “headed segments,” and duplicate/nested markers is not specified; see Blocker 3. |
| Step 5b captures baseline and candidate with metadata | **Partial** | Both artifacts now exist (`plan:17,47,139`). It is placed before its dependency, and its metadata omits PRD-required skill version and trial count (`prd.md:462-464`); see Blockers 2 and 4. |
| Acceptance criteria and traceability matrix | **Mostly integrated** | All named M1 deliverables now have exit checks (`plan:41-65`). The SKILL.md size criterion says structural/blocking while D12 says warning only (`plan:45,99,103,141,152`). |
| “Shapes at generation time” / no deterministic model application | **Integrated** | `prd.md:1-24,245-248`, `AGENTS.md:3`, and `README.md:3` now match ADR-001 (`docs/adr/adr-001-prompt-driven-rule-layer.md:7-24`). |
| `known_gap_types` reserved object shape | **Partial** | `{type, confidence}` landed (`plan:124,158`), but ranges/caps and edit preservation did not; see Blocker 5 and M2 handoff finding. |
| `vocabulary_level` rename | **Partial** | Plan and PRD use the new name (`plan:111,123`; `prd.md:251`), but README still says “vocabulary floor” (`README.md:7`). |
| Missing/invalid fields default+warn; only missing/unparseable file onboards | **Integrated policy, incomplete contract** | Policy landed (`plan:27,125`), but no normative defaults or numeric ranges exist, so the behavior cannot be implemented consistently; see Blocker 5. |
| `IM_DUMB_PROFILE` path-only, hard-error override | **Integrated** | `plan:26,127,141`; README update is explicitly scheduled in step 11 (`plan:145`). |
| D11 precedence and ADHD override | **Integrated as selected** | `plan:102,141`. An unhandled higher-priority user exact-format contract remains a fresh implication; see Blocker 3. |
| D10 ADHD definition/checker warnings | **Integrated as selected** | `plan:29,61,101,136,151`. Whether D9 bold markers count as D10 headings remains undefined. |
| D14 golden schema + hand validator + SHA-256 manifest | **Partial** | Top-level fields and hash idea landed (`plan:79,105,138`), but field constraints, `expect` semantics, pair invariants, manifest format, and drift verification did not; see Blocker 2. |
| D12 ceilings and SKILL.md budget | **Partial** | +30%/+60% and M1 report-only status landed (`plan:20,48,65,103`). Warning versus blocking conflicts, and token formulas are incomplete; see Notes 2–3. |
| TS 6.0.3, Node dev floor, nodenext, `erasableSyntaxOnly`, action pins | **Integrated selections, incomplete execution** | Selections landed (`plan:36,95,134,144`). Native `.ts` tests versus emitted ESM import resolution is not designed; see Blocker 6. |
| Onboarding flow and no-script fallback | **Partial** | Questions, skip defaults, confirmation, edit flow, and fallback landed (`plan:141`). Actual defaults are absent and the hidden M2 state can be erased; see Blocker 5 and M2 handoff finding. |
| Isolated dist smoke | **Integrated** | `plan:42,144,153`. |
| Manual branch protection/override bootstrap | **Integrated** | `plan:134,159`. |
| PR-title lint only on pull requests | **Integrated** | `plan:134,144`. |
| D13 frontmatter subset parser | **Integrated** | `plan:104,136`. |
| `Intl.Segmenter` and Markdown exclusions | **Integrated in plan** | `plan:98,136,151`. PRD still says only “instructional sentences” (`prd.md:264-265`) while the accepted plan applies the cap to all prose (`plan:28,98`). |
| Built-in filler lexicon union profile phrases | **Integrated** | `plan:58,81,136`. |
| README pre-release/npx correction | **Partial** | Banner and qualified npx fetch wording landed (`README.md:20,26`), but the Security section repeats the absolute “no remote fetch-and-execute” claim (`README.md:50`). |
| Path-filter/override/spend deferrals and PRD cross-reference | **Integrated** | `plan:20,144`; `prd.md:453-456`; `AGENTS.md:15`. |
| `CLAUDE.md` import-only invariant | **Integrated** | `CLAUDE.md:1`. |

### B. Blocking findings

- **Blocker 1 — the “one bundled JS file” build is not implementable as designed.** The plan separates reusable logic and the CLI into `src/profile.ts` and `src/profile-cli.ts`, but step 9 copies only compiled `profile-cli` to `skill/im-dumb/scripts/profile.js` (`docs/plans/m1-profile-and-language-rules.md:73-76,95,135,143`). `tsc` does not bundle imports; the copied CLI will retain a relative import to a helper that is not bundled. This conflicts with ADR-001’s one-artifact decision (`docs/adr/adr-001-prompt-driven-rule-layer.md:11`). **Recommended correction:** use one self-contained source module that exports profile functions and runs the CLI behind a direct-execution guard. Do not add a bundler for one file.

- **Blocker 2 — eval artifact contracts are still too incomplete to implement the pre-code gate.** D14 leaves the types/enums for `category`, `reference_facts`, `must_preserve`, checker IDs, and especially `expected_checks[].expect` undefined (`plan:105`). `pair_id` has no invariant requiring exactly two cases with identical prompts and profiles differing only in `adhd_mode`. The manifest has no path/serialization format, generator/verifier, or CI drift check (`plan:105,136,138,144`). `eval/baselines/README.md` is only named; no machine-readable baseline/candidate shape is selected, although step 8 must parse it (`plan:85,139,142`). Captures also omit `skill version` and `trial count`, required for every result artifact by `prd.md:462-464`. This violates eval-before-implementation (`AGENTS.md:13`) because the validator and capture reader still require design decisions.

- **Blocker 3 — D9/D10/dual-output behavior has unresolved structural branches.** D9 requires fixed bold markers, D10 requires “headed segments,” and FR6 also requires plain+technical dual output (`plan:30,100-102`). The plan never says whether bold marker lines are D10 headings, whether dual versions sit inside one outer marker sequence or repeat the sequence, how duplicate/nested markers are treated, or whether code fences/quotes can satisfy a marker (only one false-positive test is named at `plan:151`). More importantly, Answer+Why are unconditional for `answer-first`; that can violate an explicit user request for exact JSON, code-only, or another machine-readable format. D11 does not place an explicit user output contract in precedence (`plan:102`). **Recommended correction:** one outer marker sequence, exact full-line markers exactly once outside code/quotes; distinct nested `Plain`/`Technical` labels; treat the markers as D10 segment headings; explicit user-required machine format outranks skill shape and causes that case to skip the shape checker.

- **Blocker 4 — the declared ordered dependency graph is not topological.** The plan says steps are ordered and independently verifiable (`plan:132`), but step 5b appears before step 7 while declaring a dependency on step 7 (`plan:139-141`). Step 8 formally depends only on step 1 although its milestone report consumes step-5b data (`plan:142`). There is no cycle, but an implementer cannot execute the written order. **Recommended correction:** move capture after step 7 and make step 8 depend on step 5b for milestone verification (its unit-test implementation can still start after step 1).

- **Blocker 5 — the persisted profile still lacks a normative validation/default contract.** The JSON block uses pipe-delimited pseudo-enums and examples, not defaults (`plan:107-121`). No allowed range exists for `sentence_length_cap`, `paragraph_topic_limit`, or `known_gap_types[].confidence`; no cap exists for `known_gap_types[].type`; and “printable-ASCII+basic-unicode” is not a deterministic character policy (`plan:124-126`). Yet missing/invalid values must default predictably and step 2 promises boundary tests (`plan:27,125,135`). These choices become persisted API under strict SemVer (`prd.md:603-610`). The CLI also does not define stdout-only JSON, stderr warnings, or which conditions map to exits 0/1/2 (`plan:44,135`). **Recommended correction:** add a compact field table with type, default, bounds, and load/save policy; define warnings on stderr and exits 0 success-including-warnings, 1 data/I/O/path failure, 2 usage failure.

- **Blocker 6 — the TypeScript test/import strategy is incomplete.** Step 1 runs `.ts` tests directly under Node while also emitting nodenext ESM (`plan:134`). Native Node TypeScript execution expects runtime-resolvable extensions; emitted ESM expects `.js`. The plan names neither `rewriteRelativeImportExtensions` nor an alternative in which tests import already-built `dist/`. Without one strategy, source imports can work in development or after build, but not necessarily both. **Recommended correction:** use `.ts` relative imports plus TypeScript’s relative-import rewrite option, or make `npm test` build first and test `dist/`; choose one in step 1.

### C. Fresh-eye findings and residual risks

- **Major — M2 profile state can be erased by M1 onboarding/editing.** Step 7 hides `known_gap_types` and says re-running onboarding edits current values (`plan:141`). It does not require load-modify-save preservation of that hidden array. Once M2 populates it (`prd.md:308-315`), an ordinary profile edit could reset learned gaps to `[]`. Require both scripted and fallback edit paths to preserve hidden known fields unchanged.

- **Major — SKILL.md budget is feasible, but the enforcement is contradictory and has little margin.** Step 7 requires 9 body concerns and 9 user-editable profile fields: load/env behavior; onboarding/edit/fallback; 9 language rules; ADHD exemption plus 3 structural rules; 4 markers plus omission/narrative rules; 3 dual-output triggers; 5 precedence levels; and 2 manual invocation aliases (`plan:28-30,100-103,107-127,141`). A terse allocation is approximately: profile load 70 words, onboarding/edit/fallback 280, language rules 140, ADHD 90, output shape 110, dual output 90, precedence 50, invocation 20, glue 60 — about **910 body words**. The 1000-word ceiling is viable if extended schema/help stays in the CLI/README, but not generous. D12 says `>1000` is a warning while acceptance and testing say structural blocking (`plan:45,99,103,141,152`). Make it an error and target ≤900, or explicitly make acceptance warn-only; the current plan says both.

- **Major — token-overhead math is not reproducible yet.** “chars/4” does not define UTF-16 code units versus Unicode code points, rounding, corpus aggregate (ratio of totals versus mean of case percentages), or a zero-character baseline (`plan:97,142,151`). Use Unicode code points, retain fractional estimates, define aggregate as `(sum(candidate)/sum(baseline)-1)*100`, and fail a zero-baseline pair as invalid.

- **Major — checker applicability exceeds its input contract.** D3 gives checkers only `(text, profile)` (`plan:94`), but correct D9 applicability can depend on the prompt’s exact-format requirement, and golden `expected_checks` decides which checks should run (`plan:105`). Keep pure checker functions, but make the eval dispatcher select checks from the case; do not make a text-only checker guess user intent.

- **Note — checker “config” does not need a new file.** D3 mentions checker config, but no config path exists in the layout (`plan:74-88,94`). Export typed constants for the default cap and 10% threshold from `checkers.ts`; add a file only if M3 proves runtime configuration is needed.

- **Note — sentence-cap terminology remains inconsistent.** Revision 2 correctly says all prose (`plan:28,98`), while the PRD still limits the rule to instructional sentences (`prd.md:264-265`). Apply the already-selected prose wording to the PRD rather than reopening D7.

- **Note — README has two missed errata.** “Vocabulary floor” remains at `README.md:7`, and `README.md:50` drops the npx qualification correctly stated at `README.md:26`.

### D. M2 handoff readiness

M2 entry sequencing is recorded: categories 4–5 and gate scaffolds start M2 (`plan:154`; `AGENTS.md:15`). The handoff is not safe until:

1. hidden `known_gap_types` values survive M1 edit/save paths;
2. its item bounds are normative (`type` and `confidence`);
3. the golden README states how the versioned single-turn schema will be extended for multi-turn category 4–5 cases without rewriting existing M1 cases; and
4. capture artifacts retain skill version/trial count and a CI-verified dataset manifest, so M2 can identify what it inherited.

## Question queue

| # | Impact | Question | Recommended answer | One-line reasoning |
|---|---|---|---|---|
| Q1 | **Blocking** | How is the one-file bundled profile CLI produced without a bundler? | Merge profile functions and the CLI entry point into one self-contained TypeScript module. | Plain `tsc` does not collapse `profile-cli.ts` plus `profile.ts` into the one permitted JS artifact. |
| Q2 | **Blocking** | What exact machine-readable contracts do golden cases, the manifest, and capture pairs use? | Define them in the two READMEs, including enums/types, `expect` semantics, pair invariants, manifest path/hash verification, baseline/candidate JSON shape, skill version, and trial count. | Both validators and the token reader otherwise have to invent their inputs after eval design was supposedly frozen. |
| Q3 | **Blocking** | When do D9 markers apply, and how do dual output and D10 nest under them? | Require one exact outer marker sequence for explanatory prose, use distinct inner Plain/Technical labels, count marker lines as D10 headings, and exempt explicit machine-format responses. | This gives the model and checker one structure without breaking JSON/code-only user contracts. |
| Q4 | **Blocking** | What is the actual topological step order? | Move 5b after step 7 and make the acceptance execution of step 8 depend on 5b. | The current “ordered” list points backward from 5b to 7. |
| Q5 | **Blocking** | What are every profile field’s default, bounds, and validation outputs? | Add a normative table and reserve stdout for JSON, stderr for warnings, with exit 0/1/2 mapped explicitly. | Default+warn and boundary tests are not deterministic without these values. |
| Q6 | **Blocking** | How will direct `.ts` tests and emitted nodenext ESM resolve the same imports? | Use `.ts` source imports with relative-import rewriting, or test built `dist/`; document one choice in step 1. | The current compiler/test settings do not define a path that is guaranteed to run both ways. |
| Q7 | **Blocking** | Is the 1000-word SKILL.md threshold blocking or warning-only? | Make `>1000` an error and use ≤900 as the drafting target. | Acceptance already calls body size structural/blocking, and the estimated required body is about 910 words. |
| Q8 | **Blocking** | How does onboarding edit a profile after M2 has populated hidden gaps? | Load-modify-save user fields while preserving `known_gap_types` unchanged, including the no-script fallback. | Resetting the hidden array would erase learned comprehension state. |
| Q9 | Non-blocking | What exact formula defines D12 token overhead? | Count Unicode code points, retain fractional `chars/4`, ratio summed candidate/baseline totals, and reject zero baselines. | Reproducible ceilings need one counting and aggregation rule. |
| Q10 | Non-blocking | Where does checker tuning live in M1? | Keep typed constants in `src/checkers.ts`; do not add a config file. | Only two internal values exist, so a new config surface is unnecessary. |
| Q11 | Non-blocking | Should the remaining doc errata be applied now? | Replace README “vocabulary floor,” qualify its security fetch claim, and change PRD “instructional” to “prose.” | These are consistency fixes for decisions already made, not new branches. |

## Verdict

**Not sign-off-ready.** No architecture reversal is needed, but six implementation/eval contracts still require invention and one declared step order is invalid.

Minimal change set:

1. Collapse the profile implementation/CLI into one compilable bundled artifact and specify CLI streams/exits.
2. Finish the normative profile table and preserve hidden M2 state on edits.
3. Define D9 applicability, exact marker parsing/nesting, and its D10/dual-output interaction.
4. Complete golden/capture README schemas and add manifest drift verification plus PRD traceability metadata.
5. Topologically reorder capture/measurement dependencies and select one TS import/test strategy.
6. Resolve SKILL.md budget severity, define token math, and apply the three mechanical doc errata.

## Decisions Made

None; this was review-only. Existing D1–D14 decisions were treated as fixed. Recommendations above close unspecified implications rather than reopening those choices.

## Terms Defined

None. No `CONTEXT.md` exists, and no new domain term is needed.

## ADRs Created

None. The corrections are execution contracts under ADR-001, not new hard-to-reverse architectural trade-offs.

## Code Contradictions Found

None; the repository is greenfield. Document contradictions are recorded in the integration audit and findings.

## Deferred Decisions / Open Risks

- Prompt-only rule compliance remains probabilistic by ADR-001.
- Single-run M1 captures remain noisy and must not become M3 ground truth (`plan:97,139`).
- Gate 3 enforcement and Layer 2 execution remain deliberately deferred to M3 (`plan:20`; `AGENTS.md:15`).
- Multi-turn golden schema details may land at M2, but M1 must document a backward-compatible extension point first.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "review-findings: six blockers and additional major findings cite exact plan/PRD/README/ADR paths and lines; residual-risks are listed under Deferred Decisions / Open Risks"
    }
  ],
  "changedFiles": [
    ".pi-subagents/artifacts/outputs/84ed4069/docs/plans/reviews/round3-sol.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "line-numbered full document inspection with nl -ba and functions.read",
      "result": "passed",
      "summary": "Read the plan, PRD, agent docs, README, ADR, prior reviews, and interrogation skills; root plan.md/progress.md were confirmed absent."
    },
    {
      "command": "grep for resolved terminology and schema/budget terms",
      "result": "passed",
      "summary": "Confirmed generation-time wording and found residual README vocabulary/fetch wording plus the warning/blocking budget conflict."
    },
    {
      "command": "git status --short; git ls-files; file inventory",
      "result": "passed",
      "summary": "Confirmed greenfield state with no tracked source files and no staged files; repository artifacts are currently untracked."
    },
    {
      "command": "node acceptance-report parse check (first shell-quoted attempt)",
      "result": "failed",
      "summary": "Markdown backticks were interpreted by the shell; no files were changed."
    },
    {
      "command": "node acceptance-report parse check using marker offsets; git diff --cached --quiet",
      "result": "passed",
      "summary": "Acceptance JSON parsed and the index has no staged files."
    }
  ],
  "validationOutput": [
    "Acceptance-report JSON parsed successfully.",
    "Round-2 resolution audit completed across all requested documents.",
    "Dependency graph checked: no cycle, but step 5b precedes its step-7 dependency and step 8 omits its data dependency.",
    "SKILL.md content budget estimated at about 910 body words against the proposed 1000-word ceiling.",
    "No source code or runnable project tests exist yet."
  ],
  "residualRisks": [
    "Prompt-driven compliance is probabilistic by ADR-001.",
    "M1 model captures are single-run and noisy.",
    "M2 multi-turn schema extension remains deferred and must preserve M1 cases."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added only the requested Round-3 interrogation report; no plan, project document, source, or test was modified.",
  "reviewFindings": [
    "blocker: docs/plans/m1-profile-and-language-rules.md:73-76,95,135,143 - plain tsc cannot turn two importing profile modules into the one permitted bundled JS file",
    "blocker: docs/plans/m1-profile-and-language-rules.md:105,138-144 - golden, manifest, and capture contracts remain too incomplete for validators and token measurement",
    "blocker: docs/plans/m1-profile-and-language-rules.md:30,100-102 - D9 markers do not define dual-output nesting, D10 heading semantics, or exact-format exemptions",
    "blocker: docs/plans/m1-profile-and-language-rules.md:132,139-142 - the ordered step list places 5b before dependency 7 and understates step-8 data dependencies",
    "blocker: docs/plans/m1-profile-and-language-rules.md:107-128,135 - profile defaults, numeric bounds, known-gap bounds, charset, CLI streams, and exit meanings are not normative",
    "blocker: docs/plans/m1-profile-and-language-rules.md:134 - native TypeScript tests and emitted nodenext ESM have no shared import-resolution strategy",
    "major: docs/plans/m1-profile-and-language-rules.md:141,158 - onboarding can erase hidden known_gap_types after M2 populates them",
    "major: docs/plans/m1-profile-and-language-rules.md:45,103,141,152 - the 1000-word SKILL.md budget is simultaneously blocking and warn-only",
    "major: README.md:7,50 and prd.md:264-265 - three resolved terminology/wording errata remain inconsistent"
  ],
  "manualNotes": "Root plan.md and progress.md, CONTEXT.md, and source code do not exist. No ADR was warranted."
}
```
