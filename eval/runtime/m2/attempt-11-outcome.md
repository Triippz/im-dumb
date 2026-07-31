# M2 attempt 11 — automated fail (preserved)

Model: cursor/grok-4.5 with PI_CURSOR_SETTING_SOURCES=none after no-narration prompt/harness harden.

- Captures: 17/17
- Automated thresholds: FAIL
- Triggers: 0/2; diagnoses: 0/7; prose errors: 12
- Failed: trigger-huh, trigger-dont-understand, second-failure-after-diagnosis, second-failure-after-direct-repair, false-positive-quoted

Residual: diagnosis replies still prepend intent narration before the frozen heading/JSON. Attempt 12 switches to cursor/composer-2.5.
