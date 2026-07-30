Run the `static-analysis-integration` skill's gate-promoted checks (plugin `review-checks.json` entries with `"gate": true`) over the files touched for `{{inputs.feature}}`.

- No gate-promoted rulesets configured for this repo's active plugins → say so plainly ("static-analysis: skip, no gate-promoted rulesets") — graceful degradation, not a failure to hide.
- Rulesets configured → report every finding (file:line, rule, severity), as the last thing you do. `ERROR`-severity findings mean this slice is not ready — say so explicitly; `WARNING`/`INFO` are non-blocking context.

This step is not gated by a marker file — report accurately; `types` next and the human at `open-mr-gate` are the run's real safety net.
