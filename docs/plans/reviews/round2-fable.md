# round 2 interrogation report — m1 plan (fable)

Plan under interrogation: `docs/plans/m1-profile-and-language-rules.md`
Cross-referenced: `prd.md`, `AGENTS.md`, `README.md`, `CLAUDE.md`, `docs/adr/adr-001-prompt-driven-rule-layer.md`
Note: task header referenced `plan.md` / `progress.md` at repo root — neither exists; the plan file above is the only plan artifact. No CONTEXT.md exists (glossary empty). Greenfield — no code to cross-reference; code checks below are doc-vs-doc.

---

## A. Integration audit of round-1 decisions

| # | Round-1 decision | Status | Evidence / residual |
|---|---|---|---|
| 1 | D2/ADR-001, "rule engine"→"rule layer" | **Partial** | Errata landed: grep confirms zero "rule engine" in prd.md; §4.2, §5.1 (~line 249), §12 all read "rule layer" — matches ADR-001's "3 occurrences". **Residual A1, A2 below.** |
| 2 | Step 5b baseline capture | **Partial** | Plan step 5b present with model id/version/date/dataset-hash metadata per prd §9.9. **Residual A3**: baselines only — no capture path for *candidate* (profile-applied) responses that FR8/step 8 require; capture procedure (which model, what prompt harness) unspecified. |
| 3 | D8 severity split | **Clean** | Consistent across §2 acceptance criteria, D8, step 4 `--skill-doc` mode, §5 self-check paragraph. |
| 4 | §9.10 per-milestone + Layer-2 aspirational | **Partial** | AGENTS.md invariant-7 paragraph records both. **Residual A4**: plan step 10 "No path filtering in M1" contradicts prd §9.9 ("Evals run only on diffs touching…") and §9.10 ("path-filtered triggers") with no recorded deferral — Layer 2 got an explicit deferral sentence, path filtering did not. §9.10 "override mechanism" and "spend alerting" likewise unaddressed in step 10 (spend is genuinely N/A in M1, but nothing says so). |
| 5 | Unknown fields: reject-save / warn-ignore-load | **Clean** | Plan §3 schema note + step 2 + §5 edge cases. Adjacent new gap → B5. |
| 6 | Sentence cap D7 (prose sentences, >10%, tunable) | **Partial** | D7 present. **Residual A5**: D3 says checkers are pure over `(text, profile)` — cap should come from `profile.sentence_length_cap` — but D7 says "cap and threshold live in tunable checker config". Two sources of truth for the cap; config file location/format unspecified. |
| 7 | IM_DUMB_PROFILE first in load order | **Clean** | Step 2 load order; user-facing doc deferred to step 11 README pass — acceptable. |
| 8 | Ship profile JS only | **Mostly clean** | Step 9 explicit. Minor: D4 still says "compiled scripts committed" generically (reads as all scripts); step 9's dependency is listed as step 4 (check-cli) though the shipped artifact comes from step 2. |
| 9 | Single npm package | **Clean** | Step 1. |
| 10 | Minimal CI first PR → completed step 10 | **Clean** | Steps 1 and 10, §6 rollout. |
| 11 | tone enum + string length caps (injection surface) | **Partial** | Schema note present with rationale. **Residual A6**: no concrete cap values or charset defined; `learning_asset_preferences.formats` has no validation rule (enum vs free string) — it is itself an injected string array. |
| 12 | Golden dataset cats 1,2,3,6 + Layer-1 schema validation | **Partial** | Step 5 with `eval/golden/README.md` mapping. **Residual A7**: "JSON-schema validated" implies a JSON Schema validator — that's a dependency; plan pins only `typescript` as devDep. Hand-rolled validator vs ajv-as-devDep undecided. Case-file schema itself underdesigned → B7. |
| 13 | Toolchain (Node ≥24 ESM, TS 6.0.3, type-stripping tests, action pins) | **Partial** | All present in steps 1/10, NFR2. **Residual A8**: (a) "`typescript` ~6.0.3 exact-pinned" is self-contradictory — tilde is a range; (b) type stripping is erasure-only (no enums/namespaces) but tsconfig spec omits `erasableSyntaxOnly: true`, the flag that makes the constraint compile-time-enforced; (c) `engines >=24` admits 24.0 while plan itself says stripping is stable "on Node ≥24.12" — dev-only exposure, worth one line. |
| 14 | "all five gates §9.2" errata | **Clean** | prd §11.4 and AGENTS.md Governance both amended; grep finds no "Layers 1-6". |

### Integration residuals (detail)

- **A1 — "rewrites LLM responses" survives ADR-001 in three docs.** prd.md line 3 (Overview), README.md line 3, AGENTS.md line 3 all open with "rewrites LLM responses". ADR-001's entire decision is *no rewriting* — one-shot generation, "no executable rewrite engine", "not mechanical rewriting". AGENTS.md is the agent operating contract; its first sentence describing the rejected architecture is exactly the kind of drift the doc-sync rule (AGENTS.md §Doc sync) exists to prevent. Severity: **major** (contract wording), fix is cheap: "shapes LLM responses at generation time" or similar in all three.
- **A2 — prd §5.1 "deterministically applied by the rule layer".** ADR-001 Consequences: "Rule compliance is probabilistic, not guaranteed." A prompt-driven layer cannot apply anything deterministically; only the *checkers* are deterministic. Round-1 errata swapped the noun but left the adverb. Severity: minor errata — "consistently applied" or "applied at generation time".
- **A3 — candidate-response capture missing.** FR8 + step 8: "computes overhead % of profile-applied response vs stored baseline". Step 5b captures only unmodified baselines. Profile-applied candidates must also be manually captured (no LLM runner until M3), but no step produces them, no metadata format covers them, and step 8's "real data from 5b" implies 5b suffices — it doesn't. Severity: **major** (an in-scope FR is unexecutable end-to-end as written).
- **A4 — unrecorded prd §9.9/§9.10 deviations** (path filtering, override wiring, spend alerting). Severity: minor — needs one recorded sentence, same treatment Layer 2 got.
- **A5 — sentence-cap source ambiguity** (profile field vs checker config). Severity: minor decision.
- **A6 — injection-surface caps unquantified.** Severity: minor; can land at implementation, but the plan sold this as a security control — controls without numbers don't review well.
- **A7 — golden validation mechanism undecided.** Severity: minor decision (recommend hand-rolled — invariant 3 spirit, and the shape is simple).
- **A8 — toolchain nits** (tilde-vs-exact, `erasableSyntaxOnly`, 24.0-vs-24.12). Severity: minor.

---

## B. Fresh findings (round-2 scope: executability, test strategy, SKILL.md body, onboarding, ADHD checkability, eval schema, CI detail)

- **B1 — BLOCKER: no profile CLI, so the onboarding flow can't execute.** Step 7: onboarding is "questions → JSON profile **via script**"; step 9 ships "compiled profile JS" into `skill/im-dumb/scripts/`. But `src/profile.ts` is specified as a *module* (types, `validate()`, `load()`, `save()`) — nothing defines a runnable entry point, argv contract, or how the model invokes it (`node scripts/profile.js init '<json>'`? stdin?). Same gap on the read path: does SKILL.md instruct the model to run the script to load the profile, or to `cat ~/.im-dumb/profile.json` and self-validate (which would bypass warn-ignore/enum logic entirely)? Steps 2, 7, 9 are all touched. Without this, step 7 is not implementable without inventing an interface — precisely what a plan is for.
- **B2 — BLOCKER: output-shape checker has nothing deterministic to check.** FR7/step 3 include an "output-shape structure" checker; FR6 defines the shape as "direct answer → why → steps → example". Detecting that ordering in free markdown is a semantic judgment, not a deterministic check — unless SKILL.md mandates machine-detectable markers (fixed headings, ordered sections). Neither step 3 nor step 7 specifies the marker contract, and prd §9.3 lists "output-shape validation" as a deterministic Layer-1 item. As written, either the checker is unimplementable or the SKILL.md output format is unconstrained. The two steps must share one defined marker spec.
- **B3 — ADHD mode ships with zero automated verification.** FR5 is in scope; golden dataset has ADHD on/off pairs (step 5) — but the pairs are annotations with no runner until M3, and the step-3 checker list contains no ADHD-structure check. Chunk size (≤3 items per group) and answer-first position are deterministically checkable; segment-boundary explicitness partially so. Either add warn-severity ADHD heuristics to step 3 or record an explicit "ADHD verification deferred to M3 judge" line. Right now it's silent — the exact "deferral deliberate, not drift" standard AGENTS.md invariant-7 sets is unmet here.
- **B4 — Gate 3 (token budget) has no ceiling and no recorded deferral; SKILL.md's own context cost is unmeasured.** prd §9.2: Gate 3 "Blocks merge if over ceiling"; prd §8: "a token-overhead ceiling is enforced". No document defines the ceiling number, and step 10's CI job list omits Gate 3 without comment. Separately: FR8 measures *response* overhead only, but the dominant M1 overhead is SKILL.md's body injected on every trigger — no size budget, no Layer-1 length check, no mention. A skill whose PRD calls token overhead "a constraint, not an afterthought" (§8) currently has an unbudgeted primary cost.
- **B5 — invalid known-field value on load: policy undefined.** FR3 says invalid profile → offer onboarding. Taken literally, one bad enum from a hand-edit torches the whole profile into re-onboarding. Unknown fields got a policy (round-1 #5); invalid values of known fields did not. Recommend per-field warn + default; reserve onboarding-offer for missing/unparseable file.
- **B6 — acceptance criteria (§2) don't cover all in-scope deliverables.** No criterion for: FR8/step 8 token-overhead script, step 5b baselines (metadata completeness), step 6 rubric existence/shape, step 11 doc sync. §6 exit criteria = "all acceptance criteria in §2 met", so these deliverables sit outside the exit gate — a milestone can "complete" without them.
- **B7 — golden case-file schema undesigned.** Step 5: "each with input, profile, expected-constraint annotations". Unspecified: annotation format (checker id + expected pass/fail? expected violation list?), how ADHD on/off pairs are linked (shared `pair_id`?), category field, case id stability (needed for §9.9 dataset-hash traceability and M3 trial aggregation). The Layer-1 CI schema check (good idea) can't be written against an undefined shape.
- **B8 — forbidden-phrase source ambiguity.** Profile default `forbidden_phrases: []`; prd §5.3 bans filler/hype categorically; D8's own example cites a rule "never say 'simply'". Is there a shipped built-in filler lexicon (in SKILL.md rules and/or checker), with profile phrases as user additions — or is the checker inert until the user populates the array? Affects step 3 fixtures and step 5 adversarial cases.
- **B9 — onboarding question set unspecified.** prd §5.1 enumerates topics; step 7 never maps questions → profile fields → defaults-on-skip. Implementer invents the flow. Medium executability gap; one bullet list in step 7 fixes it.
- **B10 — compiled `dist/` never executed in CI.** Acceptance criterion: "`dist/` scripts run via `node dist/<script>.js` with no `node_modules`" — but tests run via type-stripped `src/`, and step 10's job list never runs a dist artifact. Cheapest fix: have the Layer-1 CI step invoke `node dist/check-cli.js` (verifies the criterion and runs the gate in one job).
- **B11 — single-run baselines vs prd §9.5.** §9.5 mandates 3–5 trials/case for nondeterminism; step 5b captures one baseline per case. Fine for M1 relative-overhead approximations (D6 already accepts approximation), but the overhead numbers will be noisy — worth one acknowledging line so M3 doesn't inherit them as ground truth.
- **B12 — AGENTS.md repo-layout block goes stale at M1 merge.** Layout lists neither `src/`, `eval/`, `test/`, `dist/`, nor `docs/` — all created by this plan ("extends AGENTS.md target layout" concedes this). Step 11 says "verify AGENTS.md contracts still accurate"; make updating the layout block an explicit step-11 item, not a verification that will pass by vibes.
- **B13 — FR4 drops a prd §5.3 rule.** §5.3: "No unexplained acronyms **or stacked qualifiers in one sentence**." FR4 carries the acronym half only. Add stacked qualifiers or record why it's out.

---

## C. Question queue (impact-ordered; one question, recommended answer, one-line reasoning)

| # | Blocking | Question | Recommended answer | Why |
|---|---|---|---|---|
| Q1 | **YES** | What is the profile script's invocation contract (B1)? | Ship one CLI (`node scripts/profile.js init\|get\|set`) wrapping the module; SKILL.md invokes it for both load and save, never raw-reads the JSON | Onboarding (step 7) is unexecutable without it, and raw-read bypasses validation |
| Q2 | **YES** | What structural markers make output shape deterministically checkable (B2)? | SKILL.md mandates fixed section markers (e.g., `**Answer**/**Why**/**Steps**/**Example**` in order) when `output_shape: answer-first`; checker keys on them; spec shared by steps 3+7 | Otherwise the FR7 checker and prd §9.3 Layer-1 item are unimplementable |
| Q3 | **YES** | Which candidate responses feed FR8, and how are they captured (A3)? | Extend step 5b: capture baseline AND profile-applied response per case, same manual protocol, same metadata; or explicitly defer FR8 reporting to M3 with an errata line | FR8 is in-scope but has no data source as written |
| Q4 | **YES** | Update §2 acceptance criteria to cover FR8, 5b metadata, rubric, doc sync (B6)? | Yes — one criterion each | §6 exit gate currently excludes in-scope deliverables |
| Q5 | no | Fix "rewrites LLM responses" in prd/README/AGENTS + prd §5.1 "deterministically applied" (A1, A2)? | Yes — "shapes responses at generation time" / "applied consistently" | Operating-contract wording contradicts the accepted ADR |
| Q6 | no | Sentence-cap source (A5)? | Cap from `profile.sentence_length_cap`; checker config holds only default cap + 10% threshold | D3's `(text, profile)` signature already decides this |
| Q7 | no | Invalid known-field value on load (B5)? | Warn + per-field default; onboarding offer only for missing/unparseable file | One bad enum shouldn't destroy a profile |
| Q8 | no | ADHD Layer-1 checkability (B3)? | Add warn-severity heuristics (chunk ≤3 items, answer-first position) to step 3; judge covers the rest at M3 — record either way | Silent zero-verification violates the repo's own deferral-must-be-recorded standard |
| Q9 | no | Gate-3 ceiling + SKILL.md size budget (B4)? | Record: ceiling set at M3 when eval runner lands; add Layer-1 warn on SKILL.md body size (pick a word/token budget now) | prd §8 calls overhead a constraint; primary M1 cost is currently unbudgeted |
| Q10 | no | Golden case-file schema fields (B7)? | Define now: `id`, `category`, `input`, `profile`, `expected_checks[{checker,expect}]`, optional `pair_id`; hand-rolled validator (no ajv) | Layer-1 schema CI check needs a schema; hand-rolled keeps devDeps at one |
| Q11 | no | Forbidden-phrase built-in lexicon (B8)? | Small built-in filler list baked into SKILL.md rules + checker default; profile array = user additions (union) | Checker shouldn't be inert out of the box; D8's example already assumes a built-in rule |
| Q12 | no | Record path-filter/override/spend deferrals (A4)? | One sentence in plan step 10 + AGENTS invariant-7 paragraph | Same "deliberate, not drift" treatment Layer 2 received |
| Q13 | no | Toolchain nits (A8)? | Pin exact `"6.0.3"`; add `erasableSyntaxOnly: true`; note 24.12+ needed for dev/test | Cheap; tilde-pin wording is self-contradicting today |
| Q14 | no | Onboarding question list (B9)? | Enumerate one question per profile field with default-on-skip in step 7 | Removes the last invent-it-yourself surface in step 7 |
| Q15 | no | Run dist in CI (B10)? | Layer-1 job invokes `node dist/check-cli.js` | Verifies the no-node_modules acceptance criterion for free |
| Q16 | no | FR4 stacked-qualifiers omission (B13); AGENTS layout update in step 11 (B12); step-9 dependency (2, not 4) | Yes to all three, mechanical | Doc fidelity |

---

## D. Verdict

**Not sign-off-ready.** Round-1 decisions were integrated substantially correctly — 7 of 14 clean, no decision reversed or mangled — but two integration residuals (A1, A3) and two fresh executability holes (B1, B2) leave step 7 and FR7/FR8 unimplementable-as-written.

**Minimal change set for sign-off** (all doc edits, ~1 hour):
1. Q1 — profile CLI contract added to steps 2/7/9 (blocking).
2. Q2 — output-shape marker spec shared by steps 3 and 7 (blocking).
3. Q3 — candidate-response capture added to step 5b, or FR8 explicitly narrowed (blocking).
4. Q4 — acceptance criteria completed (blocking, trivial).
5. Q5 — "rewrites"/"deterministically" errata in prd/README/AGENTS (non-blocking but it's round-1 integration debt; close it while the file is open).

Everything else (Q6–Q16) is non-blocking: resolvable in the first implementation PRs, provided each gets an explicit line rather than silence.

## Decisions Made
None — review only; all branches routed to the question queue above.

## Terms Defined
None (no CONTEXT.md; no terminology conflicts requiring glossary entries surfaced — "rule layer" usage is now consistent post-round-1).

## ADRs Created
None. No new decision met all three ADR bar conditions; Q1/Q2 outcomes belong in the plan, not ADRs.

## Code Contradictions Found
N/A — greenfield, no source code. Doc-vs-doc contradictions: A1, A2, A5, B2 (logged above).

## Deferred Decisions / Open Risks
- Gate-3 token ceiling value — deferred to M3, must be recorded (Q9).
- npm package name `im-dumb` availability — unverified offline; check before first publish (M6 risk, not M1).
- Single-run baselines are noisy inputs to overhead numbers (B11) — acceptable M1, do not carry into M3 as ground truth.
- Layer-2 PR check remains aspirational until M3 (already recorded in AGENTS.md invariant-7 paragraph — no action).
