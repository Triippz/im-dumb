Implement the feature slice `{{inputs.feature}}`, tests-first.

1. Write the failing test(s) that define done for this slice before touching implementation code.
2. Implement the smallest change that makes them pass.
3. Do not run the project's test/lint/type-check commands yourself, the workflow runs them as separate gated steps right after this one. Stop once the implementation is complete and the tests you wrote exist on disk.
4. Do not open a merge request. That happens only after every gate below passes and a human approves at the `open-mr-gate` checkpoint.

If the slice is ambiguous or larger than fits one pass, say so and stop rather than guessing, a human is watching this run's ledger.
