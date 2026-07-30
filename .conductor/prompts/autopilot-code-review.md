Run the `code-review` skill (full tier) over the diff for `{{inputs.feature}}`.

If this is a repeat pass (findings existed last round), first apply the smallest fix for each `must-fix`/`should-fix` finding from the previous round, then re-review. Every finding you have FIXED must be REMOVED from `findings` entirely — never left in the array annotated "RESOLVED" or "fixed". A resolved finding still counted in `findings` keeps the count above zero forever, so the workflow's convergence loop never sees zero and escalates at the round cap on code that is already fixed. If you want a record of what changed, put it in a separate `resolved` array — the workflow only reads `findings`.

Write every still-open finding to `.conductor/artifacts/review.json`:

```json
{ "findings": [ { "severity": "must-fix|should-fix|consider", "file": "path", "line": 1, "message": "..." } ], "resolved": [ { "severity": "...", "file": "...", "line": 1, "message": "...", "fix": "..." } ] }
```

Writing `.conductor/artifacts/review.json` is the LAST thing you do in this step, every single time — even when `findings` is empty — because the workflow reads this file to decide whether to loop back here or move on; a review that never writes its verdict can't converge.

Never auto-launch `code-review ultra` (cloud, billed) from inside this step — surface it as an optional human checkpoint suggestion only, never invoke it yourself.
