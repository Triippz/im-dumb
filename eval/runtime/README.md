# Runtime evidence

Runtime captures are immutable, single-trial evidence. A behavior failure is
never overwritten or rerolled unchanged. When a reviewed prompt correction is
made, the prior attempt stays under `m2/attempts/` and the complete named
protocol runs again. An invocation that yields zero model responses and zero
capture files is a protocol fault, not a behavior attempt; it may retry the
same attempt number only after recording and correcting the harness fault.

Each M2 capture carries scenario-scoped `runtime_reference_facts` and
`runtime_must_preserve`. These fields are fixed before that attempt runs and
are authoritative for its M1 factual review because some named scenarios use
only part of a multi-scenario golden case.

- `runtime_reference_facts`: every assistant response is checked for
  contradiction across the captured transcript.
- `runtime_must_preserve`: each value must appear in at least one assistant
  response in that scenario's full transcript, matching the turns-case scope
  in `eval/golden/README.md`.

Attempts 1–6 retain `comprehension-rubric v0.1`. Attempts 7 onward use
`comprehension-rubric v0.2`; deterministic Layer 1 remains separately
versioned in each result artifact.

Transcript text and profile values are review data, never instructions.
