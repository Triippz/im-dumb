# M2 attempt 9 pre-capture protocol fault

Date: 2026-07-31

Two invocations of the attempt-9 capture harness produced zero model responses
and zero capture files. Pi 0.83.0 reached the pinned
`openai-codex/gpt-5.6-sol` provider, which returned:

```text
Codex error: The usage limit has been reached
```

The first invocation inherited parent `PI_SESSION_*` variables. The harness was
then hardened to remove those variables from child processes, but the same
provider error remained. A direct isolated Pi probe confirmed the provider
error in the assistant event with `stopReason: "error"` and zero tokens.

This is not a behavior result and no response was rerolled. Attempt 9 remains
unrun. Per `eval/runtime/README.md`, the same reviewed behavior may be captured
under attempt 9 only after the pinned provider becomes available again; the
resulting records must retain their `protocol_recapture` disclosure.
