# M2 attempt 9 — contaminated harness (invalid evidence)

Date: 2026-07-31

Attempt 9 captured 17 scenarios on `claude-bridge/claude-opus-4-8` after
`openai-codex/gpt-5.6-sol` hit a usage limit. Automated thresholds failed
(16/17 scenarios).

Root cause: not skill behavior. The model under test confirmed active
instructions from the operator's personal global Claude config
(caveman-mode CLAUDE.md + ponytail hook). Captures are preserved without
edits but are not valid skill evidence and are not model-comparable with
attempts 1–8.

Next clean run is attempt 10 on an isolated `cursor` provider path.
