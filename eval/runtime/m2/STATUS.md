# M2 runtime acceptance — open; automated evidence and human review are separate gates

Thirteen attempts are preserved unedited under `attempts/` and
`attempt-*-report.md`. Nothing was loosened to make a run look green.

## The series, by the numbers

Read from `attempt-*-results.json` (`runtime.all_thresholds_pass`):

| attempt | model | pass | triggers | false pos | diagnoses | taper | prose |
|---|---|---|---|---|---|---|---|
| 5 | openai-codex / gpt-5.6-sol | **yes** | 2/2 | 9/9 | 7/7 | yes | 1 |
| 6 | openai-codex / gpt-5.6-sol | **yes** | 2/2 | 9/9 | 7/7 | yes | 0 |
| 7 | openai-codex / gpt-5.6-sol | no | 2/2 | 9/9 | 7/7 | **no** | 1 |
| 8 | openai-codex / gpt-5.6-sol | no | **1/2** | 9/9 | **5/7** | yes | 1 |
| 12 | cursor / composer-2.5 | no | 1/2 | 7/9 | 3/7 | no | 8 |
| 13 | cursor / composer-2.5 | no | 1/2 | 4/9 | 5/7 | no | 14 |

Attempt 9 was contaminated by a protocol fault. Attempts 10–11 ran grok-4.5.

## What that actually says

**The automated runtime gate passed.** Attempt 6 was a clean sweep on
openai-codex / gpt-5.6-sol: every deterministic threshold green, zero prose
errors. Attempt 5 passed too. This alone does **not** close M2: the required
human rubric has conflicting stored reviews for attempt 6 and must be resolved
for whichever current capture is proposed for acceptance.

So the current red state is not an unproven design. Two things happened after
attempt 6, and they got tangled:

1. **A regression.** Prompt edits after attempt 6 broke taper (7), then
   triggers and diagnoses (8) — still on openai-codex, so the model is not the
   explanation for that step down.
2. **A model switch.** Attempts 10–13 moved to grok-4.5 and composer-2.5.
   The regression was then debugged against weaker models, which is why each
   hardening pass bought one metric and spent another.

Chasing a regression on a different model than the one that exposed it is why
thirteen attempts produced no convergence.

## Next step

Attempt 14 is a fresh cursor / gpt-5.6-terra baseline. It is intentionally **not**
a comparison to attempts 5–8: model, provider transport, harness prompt, and
post-M5 skill text differ. Score it with
`IM_DUMB_CAPTURE_ATTEMPT=14 node eval/runtime/evaluate-m2.ts` after all 17
captures complete, then run independent human-rubric reviews before making an
acceptance claim.

If the question later is specifically whether the post-6 prompt changes caused
a gpt-5.6-sol regression, run a separate, clean openai-codex / gpt-5.6-sol
series using its native transport. Do not change models mid-series.

Keep provider, model, harness prompt, skill commit, and attempt pinned together
for a whole series. Runs are only comparable when those controls match.
