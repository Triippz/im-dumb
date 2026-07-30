Run the `code-review` skill (full tier) over the diff for `{{inputs.feature}}`.

If this is a repeat pass (findings existed last round), first apply the smallest fix for each `must-fix`/`should-fix` finding from the previous round, then re-review. Every finding you have FIXED must be REMOVED from `findings` entirely — never left in the array annotated "RESOLVED" or "fixed". A resolved finding still counted in `findings` keeps the count above zero forever, so the workflow's convergence loop never sees zero and escalates at the round cap on code that is already fixed. If you want a record of what changed, put it in a separate `resolved` array — the workflow only reads `findings`.

Write every still-open **actionable** finding to `.conductor/artifacts/review.json`. `findings` may contain only `must-fix` or `should-fix`; informational/deferred `consider` notes go in `deferred`, because convergence checks `findings.length === 0`:

```json
{ "findings": [ { "severity": "must-fix|should-fix", "file": "path", "line": 1, "message": "..." } ], "resolved": [ { "severity": "...", "file": "...", "line": 1, "message": "...", "fix": "..." } ], "deferred": [ { "severity": "consider", "file": "path", "line": 1, "message": "..." } ] }
```

Writing `.conductor/artifacts/review.json` is the LAST thing you do in this step, every single time — even when `findings` is empty and even when a resumed session believes its prior verdict was final. Every invocation is a new workflow attempt and MUST overwrite the file after rechecking the current diff; saying "already final" without rewriting is a failed attempt because the engine rejects stale artifacts.

Never auto-launch `code-review ultra` (cloud, billed) from inside this step — surface it as an optional human checkpoint suggestion only, never invoke it yourself.
