# M2 runtime acceptance — open, but not for the reason the later attempts suggest

Thirteen attempts are preserved unedited under `attempts/` and
`attempt-*-report.md`. Nothing was loosened to make a run look green.

## The series, by the numbers

Read from `attempt-*-results.json` (`runtime.all_thresholds_pass`):

| attempt | model | pass | triggers | false pos | diagnoses | taper | prose |
|---|---|---|---|---|---|---|---|
| 5 | openai-codex | **yes** | 2/2 | 9/9 | 7/7 | yes | 1 |
| 6 | openai-codex | **yes** | 2/2 | 9/9 | 7/7 | yes | 0 |
| 7 | openai-codex | no | 2/2 | 9/9 | 7/7 | **no** | 1 |
| 8 | openai-codex | no | **1/2** | 9/9 | **5/7** | yes | 1 |
| 12 | composer-2.5 | no | 1/2 | 7/9 | 3/7 | no | 8 |
| 13 | composer-2.5 | no | 1/2 | 4/9 | 5/7 | no | 14 |

Attempt 9 was contaminated by a protocol fault. Attempts 10–11 ran grok-4.5.

## What that actually says

**The gate passed.** Attempt 6 was a clean sweep on openai-codex: every
threshold green, zero prose errors. Attempt 5 passed too.

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

Re-run the current `SKILL.md` on the model that passed. One run, decisive:

```bash
IM_DUMB_CAPTURE_ATTEMPT=14 \
IM_DUMB_CAPTURE_PROVIDER=openai \
IM_DUMB_CAPTURE_MODEL=<the codex model used in attempts 1-8> \
node eval/runtime/capture-m2.ts
```

- Green → the skill is sound; the composer-2.5 numbers are a capability floor
  to document, not a defect to fix.
- Red → it is a real regression. Bisect the `SKILL.md` changes between
  attempt 6 and now, on that same model, and do not switch models mid-bisect.

Keep provider, model, and attempt pinned together for a whole series. Runs are
only comparable within one model.
