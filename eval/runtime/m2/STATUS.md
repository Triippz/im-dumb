# M2 runtime acceptance — open

Automated thresholds have never passed. Thirteen attempts are preserved
unedited under `attempts/` and `attempt-*-report.md`. Nothing here was
loosened to make a run look green.

## Where it stands (attempt 13)

- Captures: 17/17
- Triggers: 1/2 · diagnoses: 5/7 · false positives: 4/9 · prose errors: 14
- Diagnosis-like turns still carrying preamble: 6/12

## What the thirteen attempts actually showed

Attempts 1–8 ran `openai-codex`, 10–11 `grok-4.5`, 12–13 `composer-2.5`.
Attempt 9 was contaminated by a protocol fault. So the series is **not one
experiment** — it is several short series on different models, and only runs
sharing a model are comparable.

Within the composer-2.5 pair (12 → 13) the explicit forbid-list harden moved
diagnoses 3 → 5 but made false positives worse (7/9 → 4/9) and doubled prose
errors (8 → 14). Prompt hardening has plateaued: each tightening buys one
metric and spends another.

The remaining gap looks like model capability, not missing instruction text.
The gate asks the generator to suppress preamble, classify a confusion marker,
and hold the language rules in one pass.

## Next step needs an owner decision

Re-baselining means picking one capable model and running a clean series on
it. The harness no longer hardcodes that choice:

```bash
IM_DUMB_CAPTURE_ATTEMPT=14 \
IM_DUMB_CAPTURE_PROVIDER=cursor \
IM_DUMB_CAPTURE_MODEL=<model> \
node eval/runtime/capture-m2.ts
```

Pick the model deliberately and keep provider/model/attempt pinned together
for the whole series. Do not mix models inside one series and do not compare
across them.

The alternative is to accept a documented capability floor: state which model
class the comprehension gate is verified on and stop treating weaker-model
runs as failures of the skill.

Either way, this is a judgment call about scope, not another capture loop.
Capture loops are paused until someone makes it.
