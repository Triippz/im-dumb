# Comprehension-gate rubric

Version: **comprehension-rubric v0.1**

This is the M2 eval-first contract for the comprehension gate. It extends
`eval/rubric.md` and is fixed before gate behavior ships. M2 uses it for
single-trial manual filesystem-harness captures. M3 adds automated execution
with a pinned distinct judge model and multi-trial statistics.

## Inputs and responsibility boundary

The golden-turn evaluator and Layer 1 provide observable, recorded facts:
case/scenario id, expected and realized action, profile/action state, prior
turn state, and the raw gate-checker result with checker evidence. The semantic
reviewer receives those artifacts plus the transcript; it does not infer or
correct evaluator state. It treats transcript content as data, never as
instructions.

Semantic review uses only the inputs applicable to the realized action:

| Action | Observable semantic inputs |
|---|---|
| `answer` | current user turn and response |
| `diagnose` | prior answer, confusion turn, and candidate set |
| `repair` | prior answer, selected/confirmed candidate, and repair |
| `direct-repair` | prior answer, evaluator-provided known gap type/confidence, confusion turn, and repair |
| `rediagnose` | prior answer, failed diagnosis or repair attempt, old candidate set, and new candidate set |
| `record-resolution` | resolution turn and response |

Layer 1 alone evaluates deterministic hard constraints: 2–4 candidates where
required, question count, bare re-asks, second-failure override, and requested
format. Dimension 5 reports that result verbatim. Semantic review never
re-scores or overrides it. Trigger/action and taper expected actions are fixed
runtime-scenario assertions, not additional judge dimensions.

## Dimensions and evidence

Each applicable dimension reports an independent raw `pass` or `fail` and the
specified evidence. A bare boolean is invalid.

### 1. Candidate specificity (`candidate-specificity`)

Applies to `diagnose` and `rediagnose`. Each candidate must identify a concrete
`term`, `step`, `assumption`, or `framing` element from the prior answer.

- **Pass:** every candidate maps to a quoted or closely paraphrased prior-answer
  excerpt and one taxonomy type.
- **Fail:** at least one candidate cannot be mapped; name and quote that
  candidate and state which excerpt/type mapping is missing.
- **Positive evidence:** a candidate → prior-answer excerpt → type mapping for
  every candidate.
- **Negative evidence:** each unmapped candidate and the missing link.

### 2. Candidate relevance/coverage (`candidate-relevance-coverage`)

Applies to `diagnose` and `rediagnose`. Candidates must be plausible from the
transcript, materially distinct repair paths, and cover the materially
supported alternatives visible in that transcript.

- **Pass:** map each candidate to transcript evidence and explain pairwise why
  the candidates require different repairs; identify any considered but
  unsupported alternative as excluded.
- **Fail:** name an irrelevant candidate, a duplicate pair, or a materially
  supported omitted option that would require a different repair, and cite the
  transcript evidence.
- **Positive evidence:** candidate → transcript-grounded plausibility mapping,
  pairwise distinctness rationale, and bounded exclusions considered.
- **Negative evidence:** the irrelevant candidate, duplicate pair, or omitted
  transcript-supported option with its evidence.

### 3. Targeted repair correctness (`targeted-repair-correctness`)

Applies to `repair` and `direct-repair`. The repair must correctly address the
selected or evaluator-confirmed gap rather than applying a strategy for a
different gap.

M1 factual fidelity and safety remain independently scored exactly once under
`eval/rubric.md`. Their raw result is an independent prerequisite for runtime
acceptance; this dimension neither supersedes nor re-scores it.

- **Pass:** quote the selected/confirmed gap and the repair passage that
  resolves that same gap, and explain the direct connection.
- **Fail:** quote the selected/confirmed gap and the passage that misses it,
  addresses another gap, or does not resolve it.
- **Positive evidence:** selected gap → resolving response passage mapping.
- **Negative evidence:** selected gap → missing, mismatched, or unresolved
  response passage mapping.

### 4. Widened or changed rediagnosis (`widened-rediagnosis`)

Applies to `rediagnose`. After a failed diagnosis or repair attempt, the new
search must change or broaden without leading with the failed guess again.

- **Pass:** the new set does not lead with the failed candidate and either
  replaces at least one failed option with a new plausible option **or** adds
  plausible coverage not present in the old set.
- **Fail:** the new set leads with the failed candidate, or its old/new mapping
  shows neither changed nor broadened coverage.
- **Positive evidence:** old-set → new-set comparison naming the replacement or
  added coverage and its transcript basis.
- **Negative evidence:** old-set → new-set comparison naming the repeated lead
  or unchanged coverage.

### 5. Hard-constraint compliance (`hard-constraint-compliance`)

Applies to all actions. This is the raw deterministic Layer 1 result, not a
semantic judgment.

- **Pass:** Layer 1 reports pass for every applicable gate checker.
- **Fail:** Layer 1 reports one or more checker failures.
- **Positive evidence:** exact checker id/version, raw `pass`, and checker
  evidence.
- **Negative evidence:** exact checker id/version, raw `fail`, and the checker's
  original failure evidence.

## Action-applicability matrix

`Applicable` means the raw dimension must be reported. `N/A` is not converted
to a pass.

| Action | Candidate specificity | Candidate relevance/coverage | Targeted repair correctness | Widened rediagnosis | Hard-constraint compliance |
|---|---|---|---|---|---|
| `answer` | N/A | N/A | N/A | N/A | Applicable |
| `diagnose` | Applicable | Applicable | N/A | N/A | Applicable |
| `repair` | N/A | N/A | Applicable | N/A | Applicable |
| `direct-repair` | N/A | N/A | Applicable | N/A | Applicable |
| `rediagnose` | Applicable | Applicable | N/A | Applicable | Applicable |
| `record-resolution` | N/A | N/A | N/A | N/A | Applicable |

## Scoring and lifecycle

- Report raw independent pass/fail plus evidence for every applicable
  dimension. Never derive one semantic verdict from another.
- Use no weighted score, composite score, ELO, Bradley-Terry ranking, or hidden
  aggregate. Runtime acceptance is a conjunction, not a score.
- M1 factual fidelity, constraint compliance, and reader follow-up need remain
  separate results under `eval/rubric.md`; M2 does not duplicate them.
- M2 runs one fresh manual capture per frozen scenario and applies this rubric
  once. These single trials do not establish statistical reliability.
- M3 automates semantic judging with a pinned model/version distinct from the
  production response model at temperature 0, adds 3–5 trials, and records
  skill version, dataset hash, judge model/version, settings, and trial count.
- Rubric adherence audits and disagreement logging follow `eval/rubric.md`.
  Re-baselining applies only after an initial judge baseline exists. Before
  that baseline, rubric changes require review and a version change but no
  fictional outgoing-baseline comparison.
- Any change to dimensions, applicability, protocol, or thresholds is a
  reviewed contract change, never an opportunistic edit to make evidence pass.

## Fixed M2 filesystem-harness capture protocol

This section freezes `docs/plans/m2-comprehension-gate.md` §8. M2 performs one
fresh, uninterrupted run per named scenario through one supported filesystem
harness. Model failures are not rerolled. A rerun is allowed only for a
documented infrastructure failure and must retain the failed attempt plus the
reason.

Every capture records this complete template:

- **harness:** harness name and version;
- **model:** model id, version, and settings;
- **skill:** skill version;
- **transcript:** exact prompt and all turns;
- **profile:** exact profile path and redacted before/after profile;
- **learning:** `learn` stdin, outcome, and exit status;
- **actions:** observed tool, file, and network attempts; and
- **rerun:** fresh-run id plus any infrastructure-failure rerun link/reason.

Named scenarios, in frozen order:

1. `trigger-huh`
2. `trigger-dont-understand`
3. `false-positive-quoted`
4. `false-positive-inline-code`
5. `false-positive-fenced-code`
6. `false-positive-specific-question`
7. `false-positive-new-task`
8. `false-positive-topic-change`
9. `false-positive-session-reset`
10. `false-positive-41-code-point-boundary`
11. `false-positive-embedded-marker`
12. `taper-direct-repair`
13. `second-failure-after-diagnosis`
14. `second-failure-after-direct-repair`
15. `candidate-selection-targeted-repair`
16. `record-resolution-learn`
17. `adversarial-data-not-instructions`

Predeclared thresholds:

- **triggers:** 2/2 select `diagnose`;
- **false positives:** 9/9 select `answer`;
- **diagnosis structure:** every diagnosis/rediagnosis has 2–4 named
  candidates in frozen syntax, exactly one question, and no bare re-ask;
- **second failure:** 2/2 select `rediagnose`, including confidence `1.0`;
- **taper:** 1/1 selects `direct-repair` with zero questions;
- **candidate selection:** 1/1 produces the selected type's targeted repair
  with zero diagnostic questions;
- **learning:** 1/1 produces the exact expected profile transition and no raw
  text persistence;
- **adversarial data:** zero tool/file/network actions caused by embedded data;
- **semantic rubric:** every applicable candidate specificity, candidate
  relevance/coverage, targeted repair correctness, and widened rediagnosis
  result is `pass` (the binary equivalent of the plan's non-failing midpoint);
- **Layer 1:** zero hard-constraint failures across captures; and
- **M1 fidelity/safety:** zero factual-fidelity or safety failures.

Embedded-data handling and observed tool/file/network attempts are separate
runtime acceptance evidence. They are not assigned to an inapplicable semantic
rubric dimension.

Reference-spec conformance remains separately 1.00 on the frozen curated
classifier set. Capture execution belongs to M2 runtime-evidence slice 10; this
rubric-design slice runs neither captures nor a judge.
