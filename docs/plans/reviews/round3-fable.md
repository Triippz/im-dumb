# round 3 interrogation report — m1 plan (fable)

Plan under interrogation: `docs/plans/m1-profile-and-language-rules.md` (Revision 2).
Cross-referenced: `prd.md`, `AGENTS.md`, `README.md`, `CLAUDE.md`, `docs/adr/adr-001-prompt-driven-rule-layer.md`, `docs/plans/reviews/round2-fable.md`, `round2-sol.md`.
Note: task header again referenced root `plan.md` / `progress.md` — neither exists (consistent with rounds 1–2). No `CONTEXT.md` (glossary empty). Greenfield — no source code; all code checks are doc-vs-doc.

---

## A. Integration audit of round-2 resolutions

Every round-2 resolution checked against Revision 2 and the errata'd docs. Grep evidence gathered for wording changes.

| # | Round-2 resolution | Status | Evidence / residual |
|---|---|---|---|
| 1 | Profile CLI (`src/profile-cli.ts`, `load\|validate\|save`, stdin/stdout JSON, exit 0/1/2, atomic save; only bundled script; SKILL.md never raw-reads) | **Clean** | Layout `:56`, step 2 `:135`, step 7 `:141` ("always via `scripts/profile.js load` — never raw-read"), step 9 `:143`, D4 `:95`, ADR-001 amended ("only script bundled … is the compiled profile CLI"). Residual on exit-code semantics → B5 (new, adjacent, not a re-litigation). |
| 2 | D9 output-shape markers, ordered, answer-first only, Steps/Example omissible | **Clean as specified** | D9 `:100`, FR6 `:29`, FR7 `:31`, step 3 `:136`, step 7 `:141`, traceability row. Fresh edge-case gaps → B1, B2. |
| 3 | Step 5b captures baseline AND candidate with full metadata | **Clean** | Step 5b `:139`: both artifacts, model id/version/date/settings/dataset-hash, linked by case id, `Depends: 5, 7` explicitly notes candidates need SKILL.md while baselines can start after 5 — the ordering-vs-dependency question from the task brief is correctly and internally consistently recorded. Acceptance criterion `:47` covers completeness. Residual: capture *procedure* still unnamed → B7. |
| 4 | Acceptance criteria completed + traceability matrix | **Clean, one contradiction** | All round-2 B6 gaps (FR8, 5b metadata, rubric shape, doc sync, spot-check) now have criteria `:39–51`. Matrix `:53–65` covers every FR4 rule, FR5, FR6, FR8, profile validity. One row-mapping nit: FR4's "no filler/hype/hedging" maps only implicitly to the "Forbidden phrases (built-in lexicon)" row — the lexicon is described as a "filler lexicon" (`:57`, step 3); whether hype/hedging phrases live in the same lexicon or in the golden-annotation row is unstated. Contradiction found between acceptance `:45` and D12 `:103` → **A-1 below**. |
| 5 | "rewrites LLM responses" → "shapes LLM responses at generation time" | **Clean** | Grep: zero occurrences of "rewrites LLM" in prd.md / AGENTS.md / README.md; all three open with "shapes LLM responses at generation time". |
| 6 | "deterministically applied" → "applied by the model at generation time" | **Clean** | Grep: zero "deterministically" in prd.md; §5.1 now reads "applied by the model at generation time". |
| 7 | `known_gap_types` reserved `{type, confidence}` | **Clean** | Plan `:124`; prd §5.2 comment intact; MAJOR-break rationale recorded. |
| 8 | `vocabulary_floor` → `vocabulary_level` | **INCOMPLETE** | Plan `:123` ✓, prd §5.2 (`prd.md:251`) ✓ — but **`README.md:7` still says "vocabulary floor"** in the What-it-does bullet, and step 11's README checklist (`:145`) does not list it. Round-2 Q2 was resolved in two of three docs. → **A-2**. |
| 9 | Missing-field/invalid-value = default+warn; only missing/unparseable file triggers onboarding | **Clean** | FR3 `:27`, schema notes `:125`, step 2 test matrix `:135`, §5 edge cases. |
| 10 | `IM_DUMB_PROFILE` = path only, hard error if invalid | **Clean** | `:127`; step 11 README item ✓. |
| 11 | D11 conflict precedence, ADHD overrides narrative | **Clean** | D11 `:102`, step 7, FR-level consistency. Interaction gap with D9/D10 → B2. |
| 12 | D10 ADHD definition (simple-answer exemption, headed segments, ≤3 siblings, warn heuristics) | **Clean** | D10 `:101`, FR5 `:28`, step 3, matrix row, §5 edge case ("ADHD simple-answer exemption"). "Headed segment" detectability gap → B2. |
| 13 | D14 golden case schema, hand-rolled validator, `pair_id`, SHA-256 manifest | **Clean** | D14 `:105`, layout `golden-schema.ts`, step 5, acceptance `:46`. Forward-compat gap for M2 multi-turn → B8. |
| 14 | D12 provisional ceilings (+30%/+60% report-only; SKILL.md ≤1000 words warn) | **Clean, one contradiction** | D12 `:103`, rubric step 6, acceptance `:48`, matrix row, out-of-scope note `:20`. Severity contradiction → **A-1**. |
| 15 | TS exact pin `"6.0.3"` + `erasableSyntaxOnly` + dev floor 24.12 | **Clean** | Step 1 `:134`, NFR2 `:35`. |
| 16 | Onboarding flow fully specified | **Clean, one contradiction** | Step 7 `:141`: per-field questions, hidden fields, default-on-skip, confirm-before-save, re-run edit, no-script fallback. Fallback contradicts FR1's absolute wording → **A-3**. |
| 17 | dist dep-free smoke in CI | **Clean** | Acceptance `:39`, §5 `:154`, step 10 `:144`. |
| 18 | Branch protection / override label manual bootstrap at step 1; title lint pull_request-only | **Clean** | Step 1 `:134`. |
| 19 | D13 frontmatter subset parser; Intl.Segmenter | **Clean** | D13 `:104`, D7 `:98`, step 3. |
| 20 | Built-in filler lexicon ∪ profile phrases | **Clean** | Step 3 `:136`, layout `src/data/lexicon.ts`, D5 review rule. |
| 21 | README pre-release banner + npx wording | **Clean** | README Install section: status banner + "no secondary remote fetch-and-execute" wording present. |
| 22 | Path-filter/override/spend deferrals recorded incl. prd §9.9 cross-ref | **Clean** | Out-of-scope `:20`, step 10 `:144`, prd §9.9 parenthetical ("Path filtering activates when expensive gates exist, M3 onward; per-milestone reading recorded in AGENTS.md"), AGENTS.md invariant-7 paragraph. |

### Integration residuals (detail)

- **A-1 — body-size severity contradiction: acceptance §2 vs D12.** Acceptance criterion (`m1-profile-and-language-rules.md:45`): "SKILL.md passes structural Layer 1 **blocking** (frontmatter validity, name sync, description length, **body-size budget**)". D12 (`:103`): "SKILL.md body budget: **warn** >1000 words". A warn-severity check cannot be part of a blocking pass-list — either the criterion silently promotes the budget to error (contradicting D12 and the checker CLI's "errors only drive exit code" rule at `:41`), or the criterion is vacuous for that item. One of the two lines must move. Recommended: keep D12's warn, reword the criterion to "…description length; body-size budget reported (warn)". Severity: **minor but normative** — as written, step 10's Layer-1 CI job is ambiguous about whether a 1001-word SKILL.md blocks merge.
- **A-2 — `README.md:7` "vocabulary floor" survived the rename.** The schema field, prd, and plan all say `vocabulary_level`; README's feature bullet still uses the term round 2 rejected as semantically inverted. Step 11's README checklist doesn't cover it, so the doc-sync pass as planned will not fix it. Severity: minor, but it is round-2 integration debt in a user-facing doc; add to step 11 or fix now.
- **A-3 — FR1 contradicts step 7's no-script fallback.** FR1 (`:25`): profile produced "via the profile CLI — never free-form notes, **never raw-written JSON**." Step 7 (`:141`): "fallback when script exec unavailable: emit validated JSON + exact path **for user to save**" — i.e., raw-written JSON, hand-saved, validated only by the model (the CLI's enum/warn/atomic-write logic is bypassed, which is exactly what FR1 exists to prevent). The fallback is right (hosted harnesses can't exec); FR1's wording is wrong. Fix: FR1 adds "…except the documented no-script fallback (step 7), where the model emits schema-shaped JSON and instructs the user to run `validate` when a shell is next available." Severity: **minor but normative** — an FR and a step currently disagree.
- **A-4 — prd §5.3 still says "Instructional sentences capped near 20 words" (`prd.md:264`) while FR4 (`:28`) claims to "encode prd.md §5.3" with a "~20-word **prose** sentence cap" and D7 applies the cap to all prose sentences.** The D7 broadening was a round-1 decision; the prd errata for this specific line was never applied (unlike "rule engine" and "rewrites"). A reader of prd alone concludes the cap covers only instructional sentences. Severity: minor errata — either amend prd §5.3 ("prose sentences, per STE's instructional-sentence guidance") or note the broadening in the plan as a deliberate extension.
- **A-5 — step 10's `Depends: 9` is incomplete.** Step 10's Layer-1 job runs the checker CLI (step 4), golden validation (step 5), and SKILL.md `--skill-doc` (step 7), yet lists only step 9. Every other step's dependency list is exhaustive; numeric ordering saves execution in practice, but the graph as annotated is wrong. Severity: cosmetic; fix the line to `Depends: 4, 5, 7, 9`.

Verified non-issues (checked, no action): step-5b ordering vs step-7 dependency (correctly annotated, see #3); traceability matrix vs FR list (complete); acceptance vs deliverables (complete post-round-2); dependency graph has no cycles; step 5 `Blocks: 7` ↔ step 7 `Depends: 3, 5` symmetric; golden categories 1/2/3/6 mapping matches prd §9.4; rubric dimensions match prd §9.6's own example triple; CLAUDE.md remains pure `@AGENTS.md`.

---

## B. Fresh findings (round-3 scope)

- **B1 — D9 has no simple-answer exemption; D10 does.** With `output_shape: answer-first`, D9 (`:100`) mandates `**Answer**` + `**Why**` *always present* — including for trivial one-line answers ("what flag disables X?"). Consequences: (a) forced `**Why**` sections on trivial responses add exactly the kind of token overhead prd §8 treats as a constraint, and pad answers the user wanted terse; (b) the shape checker errors on any legitimately short candidate; (c) golden candidates captured from a live model (step 5b) will violate it whenever the model sensibly answers short, poisoning fixtures and the D12 overhead numbers; (d) it is inconsistent with D10, which exempts simple answers (single paragraph, ≤3 sentences) from ADHD structure — the same reasoning applies verbatim to shape markers. This must be decided **before step 5** (golden `expected_checks` encode it) and step 7 (SKILL.md prose encodes it). Recommended: mirror D10 — responses meeting the D10 simple-answer definition are marker-exempt; checker skips shape check on texts under the same threshold. Severity: **blocking** (same "stable golden answers" standard that made D11 a round-2 blocker).
- **B2 — D9/D10/D11 composition underspecified on two edges.** (a) `adhd_mode: true` + `output_shape: answer-first`: do D9's bold markers count as D10's "headed segments," or must the response carry markdown headings *in addition to* markers? If both checkers run, the same structure gets evaluated under two different definitions of "segment head." (b) `adhd_mode: true` + `output_shape: narrative`: D11 says ADHD overrides narrative, and D9 says narrative = no shape check — so the ADHD warn-heuristics are the only structural check, but D10 never defines what the checker accepts as a "headed segment" (ATX heading? bold-line? horizontal rule?). One sentence fixes both: "D10's checker accepts markdown headings *or* bold-line markers (incl. D9 markers) as segment heads; when both modes are active, D9 markers satisfy D10 heading requirements." Severity: non-blocking, must land by step 3 (checker fixtures encode it).
- **B3 — SKILL.md 1000-word budget: feasible, but with little headroom — verified by counting.** Step 7's mandatory content, estimated at terse-but-usable prose: profile load + exit-code handling + `IM_DUMB_PROFILE` (~90 words); onboarding — 9 visible fields × question+default (~210); language rules, 9 rules (~120); ADHD mode incl. exemption (~70); output shape + markers + omission rules (~90); dual-output triggers (~50); conflict precedence (~40); no-script fallback (~40); manual invocation (~15); framing/transitions (~50). Total ≈ **775 words** — under budget with ~20% slack, but any elaboration (examples per rule, sample onboarding dialogue) busts it. Two notes: (a) the layout (`:52–56`) has no `references/` directory even though AGENTS.md's own skill description says "SKILL.md + scripts/ + references/" — the standard escape hatch (move onboarding detail to `references/onboarding.md`, progressive disclosure) is structurally unprovisioned; (b) budget is warn-only (D12), so this is not a blocker, but step 7 should name the escape hatch so the implementer doesn't compress rules to save the budget. Severity: non-blocking.
- **B4 — "checker config" has no format or location.** D3 (`:94`): "checker config holds only the default cap and the >10% threshold." No config file appears in the layout, no format is named, and D7 calls the threshold "tunable (PATCH)". Is this a JSON file (where? loaded how by a dep-free CLI?), CLI flags, or constants? Recommended: exported constants in `src/checkers.ts` — no file, no loading code; "tunable, PATCH" then means editing a constant and bumping PATCH, which is exactly how D12's ceilings already work in `eval/rubric.md`. Severity: non-blocking; decide by step 3.
- **B5 — profile CLI exit codes don't encode the FR3 branch the skill must take.** Acceptance (`:41`) defines exit 0/1/2 for the *checker* CLI; the profile CLI inherits "exit 0/1/2" (step 2, `:135`) with no scenario mapping. FR3 requires the *skill* to distinguish: (i) usable profile, possibly with warn+defaults applied → proceed; (ii) missing/unparseable file → offer onboarding; (iii) invalid `IM_DUMB_PROFILE` / future `schema_version` → hard error, do not onboard over it. Three behaviors, and the SKILL.md instruction "run `profile.js load`" needs a machine-distinguishable signal for each. Recommended: `load` → exit 0 + `{profile, warnings[]}` when usable; exit 1 + `{error: "missing"|"unparseable"|"env-path-invalid"|"unsupported-schema-version"}` when not; exit 2 bad invocation. Severity: non-blocking but must be pinned in step 2 before SKILL.md (step 7) can reference it.
- **B6 — numeric field validation ranges unspecified.** Round 2 quantified the string caps (`forbidden_phrases` ≤50×≤40, enums, charset) but `sentence_length_cap` and `paragraph_topic_limit` (`:113–114`) have no valid range. "Invalid value → default + warn" (FR3) is unimplementable for numbers until "invalid" is defined (is `sentence_length_cap: 0` invalid? `500`? `-3`? a float?). Recommended: `sentence_length_cap` integer 5–60, `paragraph_topic_limit` integer 1–3, out-of-range → default+warn. Severity: non-blocking; step 2 test matrix needs it.
- **B7 — `eval/baselines/README.md` content requirements omit the capture procedure.** Step 5b says candidates are captured "skill loaded, case profile applied" but never says *how* a case profile is applied to a live model run. There is an obvious clean mechanism the plan already built: write the case profile to a temp file and set `IM_DUMB_PROFILE` to it — but nothing says so, and an implementer could instead paste the profile into the prompt (different token profile, different behavior, non-comparable overhead numbers). The README requirement should enumerate: harness used, model id source, how the skill is loaded pre-installer (manual copy to `~/.claude/skills/`), profile-application mechanism (`IM_DUMB_PROFILE` temp path), and one-capture-per-case rule. Severity: non-blocking; without it the FR8 numbers are irreproducible.
- **B8 — D14 golden schema is single-turn; M2 categories 4–5 are multi-turn.** `prompt` is one string (`:105`). prd §9.4 categories 4 (gate triggers) and 5 (profile-adaptation sequences) — which AGENTS.md invariant 7 requires at *M2 start* — need turn sequences. The schema is versioned in `eval/golden/README.md` (good hook), but nothing warns that a v2 with `turns[]` is coming, and the SHA-256 manifest hashing must survive the version bump. One line in the golden README ("schema v2 at M2 adds `turns[]`; single-`prompt` v1 cases remain valid") converts a future migration surprise into a planned step. Severity: non-blocking; M2 handoff hygiene.
- **B9 — rubric step 6 omits prd §9.6's separate-judge requirement.** prd §9.6 mandates "a separate judge model from the production model to avoid self-preference bias" and periodic rubric-adherence audits. Step 6 (`:140`) records pinning, temp 0, and re-baselining but not judge≠production or the audit cadence. The rubric is the M3 contract being drafted now — cheapest moment to record both. Severity: non-blocking, one line.
- **B10 — golden README omits the dataset edit-review rule.** prd §9.4: "editing a failing test case is the quiet way a gate gets weakened." D5 gives the lexicon a "reviewed like golden data" rule, but nothing defines what reviewing golden data itself means (M6 owns CODEOWNERS; M1 can state "changes to existing case files require explicit reviewer sign-off noted in the PR"). Severity: cosmetic; one line in `eval/golden/README.md` requirements.

M2 handoff readiness overall: **good**. `schema_version: 1`, reserved `known_gap_types`, checker architecture (pure functions over text — gate structural checks like single-question-per-turn slot in cleanly), rubric, and the §5 note that M2 opens with categories 4–5 + gate scaffolds are all in place. B8 is the only handoff gap found.

---

## C. Question queue (impact-ordered)

| # | Blocking | Question | Recommended answer | Why |
|---|---|---|---|---|
| Q1 | **YES** | Does D9 exempt simple answers from markers (B1)? | Yes — mirror the D10 simple-answer definition; checker skips shape check below the threshold; record in D9 + step 7 | Golden `expected_checks` and captured candidates encode the answer; deciding after step 5 forces dataset rework |
| Q2 | **YES** | Body-size budget: warn (D12) or blocking (acceptance `:45`) (A-1)? | Warn — reword the acceptance criterion to "body-size budget reported (warn)" | Two normative lines currently disagree about whether CI blocks a 1001-word SKILL.md |
| Q3 | **YES** | Reconcile FR1 "never raw-written JSON" with the step-7 no-script fallback (A-3)? | Amend FR1: "…except the documented no-script fallback; fallback instructs the user to run `validate` when shell access is available" | An FR and a step contradict; the fallback is correct, the FR wording is not |
| Q4 | no | Fix `README.md:7` "vocabulary floor" (A-2)? | Rename to "vocabulary level"; add to step 11 checklist | Round-2 rename landed in 2 of 3 docs |
| Q5 | no | D9-markers-as-D10-heads composition (B2)? | D10 checker accepts headings or bold-line markers as segment heads; when both modes active, D9 markers satisfy D10 | Checker fixtures (step 3) encode it |
| Q6 | no | Profile CLI `load` exit-code/scenario mapping (B5)? | 0 + `{profile, warnings[]}` usable; 1 + typed error (`missing`/`unparseable`/`env-path-invalid`/`unsupported-schema-version`); 2 bad invocation | SKILL.md must branch onboard-vs-proceed-vs-halt on machine-readable output |
| Q7 | no | Checker-config format/location (B4)? | Exported constants in `src/checkers.ts`; no config file | Dep-free CLI shouldn't grow a config loader for two numbers |
| Q8 | no | Numeric ranges for `sentence_length_cap` / `paragraph_topic_limit` (B6)? | int 5–60 / int 1–3; out-of-range → default+warn | FR3's invalid-value policy is undefined for numbers |
| Q9 | no | Candidate-capture mechanism in baselines README (B7)? | Case profile → temp file → `IM_DUMB_PROFILE`; document harness, skill-load method, one-capture rule | FR8 numbers irreproducible without it |
| Q10 | no | prd §5.3 "instructional sentences" errata (A-4)? | Amend to "prose sentences (per STE's instructional-sentence guidance, broadened)" | Last surviving prd line contradicting a round-1 decision |
| Q11 | no | Note schema-v2 `turns[]` in golden README (B8); separate-judge + audit line in rubric (B9); dataset edit-review line (B10); step-10 deps `4,5,7,9` (A-5); `references/` escape hatch named in step 7 (B3) | Yes to all five, mechanical one-liners | M2/M3 handoff hygiene + graph fidelity |

---

## D. Verdict

**Not sign-off-ready — but one short editing pass away.** Revision 2 integrated the round-2 resolutions substantially correctly: 19 of 22 clean, no decision reversed or mangled, both prior blockers (profile CLI, marker spec, candidate capture, acceptance completeness) genuinely closed. No architectural or executability holes remain. What's left is one real design gap and a handful of internal contradictions:

**Minimal change set for sign-off** (all doc edits, well under an hour):
1. Q1 — D9 simple-answer exemption, recorded in D9 + step 7 + checker note (blocking: golden dataset stability).
2. Q2 — resolve body-size warn-vs-blocking contradiction between acceptance `:45` and D12 (blocking: trivial, but the acceptance criterion is normative).
3. Q3 — FR1 fallback carve-out (blocking: trivial, FR-vs-step contradiction).
4. Q4 — README.md:7 vocabulary-floor rename (round-2 integration debt; close it while the file is open).

Q5–Q11 are non-blocking: each resolvable in its owning implementation PR, provided it gets an explicit line rather than silence.

## Decisions Made
None — review only; all branches routed to the question queue.

## Terms Defined
None (no CONTEXT.md; no terminology conflicts surfaced — "rule layer", "shapes at generation time", and "candidate" usage are consistent post-round-2).

## ADRs Created
None. Q1 (D9 exemption) is plan-level, not ADR-bar: reversible, unsurprising, no rejected alternative of consequence.

## Code Contradictions Found
N/A — greenfield. Doc-vs-doc contradictions: A-1 (acceptance vs D12), A-3 (FR1 vs step 7), A-2 (README vs schema rename), A-4 (prd §5.3 vs D7).

## Deferred Decisions / Open Risks
- Gate-3 blocking ceiling calibration — M3, provisional numbers recorded (D12); carried from round 2.
- Single-run capture noise — acknowledged in step 5b; must not become M3 ground truth (carried).
- Prompt-only rule compliance remains probabilistic (ADR-001 consequence; by design).
- Hosted-harness profile transport — M4-entry decision, `IM_DUMB_PROFILE` is the hook (recorded in out-of-scope).
- npm package-name availability for `im-dumb` — still unverified offline; M6 risk (carried from round 2).
- D14 schema v2 (`turns[]`) migration at M2 — planned once Q11 lands; watch the manifest-hash compatibility.
