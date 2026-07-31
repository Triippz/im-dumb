# Judge rubric (M1 draft)

Normative reference for the LLM-as-judge layer (prd.md §9.6, Gate 2 offline
smoke suite and Gate 4 nightly full suite, prd.md §9.2). This document is
drafted in M1 per AGENTS.md invariant 7 and prd.md §9.10 ("judge rubric
drafted with non-redundant dimensions; ELO aggregation explicitly
excluded"); the judge is not executed against any model in M1 — that
runner ships at M3. Until then this file is the fixed, pre-agreed meaning
of "pass" that a real judge implementation must be built against, not
redefined after the fact to match whatever a candidate skill happens to
output (prd.md §9).

## Purpose and scope

The judge scores a single golden case (`eval/golden/cases/*.json`, D14
schema) plus one candidate response against this rubric. It runs after the
deterministic Layer 1 checkers (`src/checkers.ts`) have already passed —
the judge is never asked to re-verify what code can verify for free, and it
never overrides a Layer 1 error.

## Design rationale (ELO exclusion)

A rigorous psychometric study of LLM-judged benchmarks (cited prd.md §9.6)
found that judges frequently do not faithfully follow their stated rubric,
and that rubric dimensions meant to be independent collapse into a single
latent factor when scores are aggregated into a ranking. To keep this
rubric resistant to that failure mode:

- Dimensions are kept genuinely separable, not near-synonymous labels.
- Scoring is pass/fail-against-a-rubric, never comparative preference
  ranking.
- Results are reported raw, per dimension, never as one collapsed number.

## Dimensions

Exactly three dimensions. Each is scored independently; a dimension's
verdict never references another dimension's verdict.

### 1. Factual fidelity

Does the candidate response avoid introducing false claims, avoid
contradicting the case's `reference_facts`, and avoid dropping any item in
`must_preserve` (D14, `eval/golden/README.md`)?

- The judge checks every `reference_facts` entry for contradiction and
  every `must_preserve` entry for omission.
- **Pass**: no `reference_facts` entry is contradicted and no
  `must_preserve` entry is dropped.
- **Fail**: the judge lists each violated `reference_facts` or
  `must_preserve` entry verbatim, by index and text, so the failure is
  reviewable without re-running the judge.

### 2. Constraint compliance

Does the candidate response honor the case's `profile` (vocabulary level,
jargon policy, tone, output shape, ADHD mode) in ways the deterministic
checkers can't verify lexically — e.g. whether wording is genuinely common
vocabulary for the stated persona, not just free of specific forbidden
phrases?

- This dimension is deliberately scoped to the semantic gap left by Layer
  1; it does not re-score sentence caps, marker structure, or forbidden
  phrases, since `src/checkers.ts` already covers those at zero variance.
- **Pass**: the judge finds no constraint violation in that semantic gap.
- **Fail**: the judge lists each violated constraint, naming the profile
  field and the offending passage.

### 3. Reader follow-up need

Would the persona described by the case's `profile` need a follow-up
question before they could understand or act on this response? The judge
role-plays that reader, reads the candidate response cold, and enumerates
every concrete, specific blocking question that reader would need
answered — "blocking" meaning it prevents comprehension or action, not
idle curiosity.

- **Pass** means the judge enumerates zero blocking questions.
- **Fail**: any concrete blocking question enumerated is a fail; the judge
  records each question verbatim, not just a count, so a human reviewer
  can see exactly what the response left unresolved.

## Scoring contract

- **Independent per-dimension pass/fail.** Each of the three dimensions
  above is scored independently; no dimension's pass/fail may be derived
  from or adjusted by another dimension's result.
- **Raw per-dimension reporting.** Every judged case reports the raw
  pass/fail boolean for each dimension, plus the dimension's supporting
  evidence (violated facts, violated constraints, or enumerated blocking
  questions). No weighted sum and no single collapsed score are computed
  from the three results.
- **No ELO, no ranking aggregation.** ELO/Bradley-Terry-style ranking
  aggregation is never used anywhere in this pipeline — im-dumb evaluation
  is pass/fail-against-a-rubric, not comparative preference ranking
  between models or runs (prd.md §9.6).
- A case's overall gate status (all three dimensions pass) is a
  conjunction used only for merge-gating; it is not a scoring aggregate,
  and the raw per-dimension results remain the primary reported artifact.

## Judge model pinning

- The judge model and its exact version string are pinned in the eval
  config and recorded on every result artifact, alongside skill version,
  dataset hash, and trial count (prd.md §9.9).
- Judge calls run at **temperature 0**, so that a change in judge output is
  attributable to a real skill or judge-model change rather than sampling
  noise (prd.md §9.5).
- The judge model **must differ from the production response model** that
  generated the candidate under evaluation. A model judging its own output
  measurably favors that output (self-preference bias, prd.md §9.6); using
  a separate judge model removes that incentive rather than trying to
  correct for it after the fact.

## Rubric-adherence audit

Because judges are known to drift from their stated rubric without any
visible change in overall verdict rate, adherence is checked directly and
on a fixed schedule, not left to be discovered when scores start looking
strange.

- **Cadence**: no less often than quarterly, and additionally after any
  judge-version change (see below).
- **Procedure**: a human samples a fixed number of already-judged cases
  spanning all three dimensions, reads the judge's recorded evidence
  (violated facts/constraints, enumerated blocking questions) for each,
  and independently re-scores the same cases against this rubric text
  without seeing the judge's verdict first. The human verdicts are then
  compared against the judge's verdicts, per dimension.
- **Escalation**: if the audit finds a rate of unexplained-variance
  mismatches (human disagrees with the judge and the judge's recorded
  evidence does not support its own verdict) above the threshold set for
  that audit round, judge output for the affected dimension is distrusted
  until a re-baselining pass (below) is completed.

## Judge-version change and re-baselining

Any change to the judge model id, judge model version, or this rubric's
text is treated as a change to the measurement instrument, not a tuning
tweak, and requires re-baselining before the new judge is trusted:

1. Freeze the current judge model/version as the outgoing baseline.
2. Run the full golden set through both the outgoing judge model and the
   incoming judge model, unchanged rubric text held constant across the
   pair where possible.
3. Diff per-dimension pass/fail rates and per-case verdicts between the
   two runs; document the diff (what changed, on which cases, on which
   dimension) in the PR or release note that adopts the new judge.
4. Only after that diff is documented does the incoming judge model/version
   become the new pinned judge (Judge model pinning, above).

Silent judge-version upgrades are never permitted — a version bump is
recorded and reviewed like any other pinned-dependency bump, because a
silent judge upgrade is otherwise indistinguishable from an actual skill
regression (prd.md §9.5).

## Dataset-change handling

Golden dataset changes are governed primarily by `eval/golden/README.md`'s
reviewer sign-off rule for editing published cases; this section covers
what that means for judge results specifically:

- A **new** golden case has no prior judge history — its first judged
  result is a fresh baseline point, not compared against anything.
- An **edited, published** case (subject to the golden README's sign-off
  rule) invalidates prior judge history for that case id: post-edit
  results are treated as a new baseline, and pre-edit history for that id
  is retired rather than silently averaged with the new results.
- A **deleted** case is simply removed from the judged set; nothing to
  re-baseline.
- The golden dataset's `manifest.json` sha256 drift check
  (`eval/golden/README.md`) is the mechanical signal that ties a dataset
  change to this process: any manifest drift on a case id means that id's
  judge history must be reviewed under the rules above before its trend
  line is trusted again.

## Token-overhead ceilings (D12, provisional)

Recorded here per prd.md §9.10 ("judge rubric drafted ... "); these are the
same D12 ceilings the token-overhead script (`src/token-overhead.ts`)
reports against:

- **Aggregate ceiling**: corpus-wide overhead ≤ **+30%** vs baseline
  responses.
- **Per-case ceiling**: any single case's overhead ≤ **+60%** vs its
  baseline.
- **Status in M1**: report-only. Exceeding either ceiling is surfaced in
  the token-overhead report but never blocks a merge in M1.
- **Blocking policy**: these ceilings become a blocking gate no earlier
  than **M3 Gate 3** (Cost/token budget, prd.md §9.2), once the eval runner
  and enough captured trials exist to set them with confidence.
- Recalibrating either ceiling number is a PATCH-level change to this
  document, recorded like any other tuning-constant change (D3, D7).

## Manual review and disagreement handling

Judge drift is kept visible between scheduled audits, not just caught at
them:

- Any case where a human reviewer disagrees with the judge's per-dimension
  verdict — during a spot-check, a rubric-adherence audit, or ad hoc review
  of a nightly (Gate 4) result — is logged: case id, dimension, judge
  verdict, human verdict, and a one-line rationale for the disagreement.
- The disagreement log's rate over time is itself a judge-drift signal: a
  rising disagreement rate on a dimension is treated as an early warning
  and pulled into the next rubric-adherence audit even if that audit isn't
  due on its regular cadence yet.
- A logged disagreement does not by itself block a merge — broader
  judge-scored suites warn and route to human review rather than
  hard-blocking (prd.md §9.9), and the existing audited override path
  (required label + second approver) covers genuine urgent exceptions. The
  disagreement log's job is to keep judge drift visible and to feed the
  audit and re-baselining processes above, not to gate every PR itself.
