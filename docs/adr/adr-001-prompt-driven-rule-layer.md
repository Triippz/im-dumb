# ADR-001: Prompt-driven rule layer, no executable rewrite engine

Status: accepted (2026-07-30)

## Context

The PRD originally called the M1 deliverable an "STE-inspired rule engine," wording that implies an executable program that takes model output and rewrites it into profile-compliant language. The user's core requirement is single-pass generation: the AI responds once, correctly formatted, with no intercept-and-fix loop and no second round-trip.

## Decision

The language rules are written instructions in `SKILL.md`, loaded into the model's context before generation. The model applies the user's profile (vocabulary, sentence caps, jargon policy, ADHD mode) while producing its response, first pass, one shot. Scripts never touch the response path. The only script bundled inside the skill directory is the compiled profile CLI (load/validate/save). Deterministic checkers (sentence caps, forbidden phrases, structure) live repo-side and run in evals and CI only.

The comprehension gate (M2) runs on a later conversational turn after new user input: when the user signals confusion, the model re-diagnoses with named candidates and generates a targeted repair. That path is also model-driven, not mechanical rewriting, and its resolved confusions feed `known_gap_types` so future first-pass responses need less repair.

PRD wording amended: "rule engine" → "rule layer" (3 occurrences).

## Alternatives Considered

- **Deterministic rewrite engine**: a program that transforms non-compliant prose into compliant prose. Rejected, rewriting arbitrary English *is* the problem LLMs solve; infeasible without an LLM call, and the dependency-free-scripts invariant rules out NLP libraries. Also structurally requires the intercept-fix-resend loop the user explicitly rejected.
- **LLM-based post-processing pass**: send the response to a second model call for simplification. Rejected, doubles token cost and latency, violates single-pass requirement, and hosted harnesses (Claude API, OpenAI) disallow network calls from skill scripts.

## Consequences

- Rule compliance is probabilistic, not guaranteed, the model can drift. Mitigated by deterministic checkers gating evals/CI (Layer 1) and judge-scored suites (M3).
- Every eval, the golden dataset, and the SKILL.md structure assume this architecture; reversing it later means rebuilding the product.
- Token overhead stays near zero on the response path, no second call, no injected rewrite step.

## Amendment (M2 planning, 2026-07-31)

`prd.md` §6.2 describes the comprehension-gate lexical pre-filter as
"deterministic" and "using no model call," which read as a runtime guarantee
conflicts with this ADR's "only `profile.js` is bundled, the gate is
model-driven" decision above, no bundled script can intercept a user's
message before the model's turn under the open Agent Skills convention this
product targets; there is no portable pre-response hook. Bundling a second
script (`gate.js`) would not fix this: the model would still have to
probabilistically decide to invoke it and route untrusted text through it,
and hosted surfaces have no hook to call it from at all.

Corrected contract, binding from M2 onward: the pre-filter's *reference
rules* are deterministic and require no extra classifier or model call to
define what counts as a trigger. That determinism lives in a repo-side,
non-bundled classifier used for tests and fixtures and mirrored in
`SKILL.md`'s prose. Runtime *application* of those rules stays model-driven.
This materially corrects the former deterministic-runtime promise because an
open Agent Skill cannot provide it portably. `profile.js` remains the only
bundled runtime script; M2 does not add `gate.js` or any second bundled
artifact. M1's prompt-driven, one-shot, no-rewrite decision remains unchanged.

Full M2 contract: `docs/plans/m2-comprehension-gate.md`.
