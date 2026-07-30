Run the `test-health` skill against the tests touched or added for `{{inputs.feature}}` in this run (zero assertions, `sleep()`, live network calls, shared mutable state, tautological assertions).

Report the result plainly, as the last thing you do: no findings means say so explicitly ("test-health: clean"); any finding needs file:line and what's wrong. This step is not gated by a marker file — the tests/lint/types shell steps around it and the human at `open-mr-gate` are the run's real safety net, so report accurately rather than optimizing for what makes the step "pass".
