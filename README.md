<p align="center">
  <img src="assets/im-dumb-full.png" alt="im-dumb translating a jargon-heavy AI response into a clear explanation" width="100%">
</p>

<h1 align="center">im-dumb</h1>

<p align="center"><strong>Makes AI explain things the way your brain actually gets them.</strong></p>

<p align="center">
  <img alt="Status: pre-release" src="https://img.shields.io/badge/status-pre--release-f59e0b">
  <img alt="Node.js 24 or newer" src="https://img.shields.io/badge/node-%3E%3D24-5fa04e">
  <img alt="No invocation-time network calls" src="https://img.shields.io/badge/runtime_network-none-7c3aed">
  <a href="https://github.com/Triippz/im-dumb/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Triippz/im-dumb/actions/workflows/ci.yml/badge.svg"></a>
</p>

AI can be technically right and still make zero sense.

You ask one question. It replies with jargon, hidden assumptions, and six paragraphs that somehow avoid the answer. **im-dumb** gives your agent a communication profile so it generates the first response with your words, structure, and tolerance for detail.

You are not dumb. The interface forgot who it was talking to.

## Before / after

You ask: **“How does a message queue work?”**

Without a profile:

> A message queue facilitates asynchronous, decoupled communication between distributed producers and consumers while supporting delivery guarantees and fault tolerance.

With im-dumb:

> **Answer**
>
> A message queue is a mailbox between parts of an app.
>
> **Why**
>
> One part leaves work in the mailbox. Another part picks it up when ready. If something breaks, the work can wait and try again.

The model applies the profile while generating the answer. There is no second rewrite round trip.

## What it changes

- **Vocabulary level** (`vocabulary_level`) — `common` everyday words, `technical-ok` standard technical words with plain context, or `expert` established shorthand.
- **Your structure** — answer first, short sections, controlled sentence length, and examples when they help.
- **Your jargon policy** — avoid it, define it once, or allow it.
- **ADHD mode** — restructures long answers into headed chunks with no more than three sibling items. It is a communication preference, not a medical feature.
- **Comprehension repair** — planned for M2: when something still does not land, the skill names likely confusion points instead of asking a vague “what do you mean?”

## How it works

1. A short onboarding flow creates `~/.im-dumb/profile.json` (override the path with `IM_DUMB_PROFILE`).
2. The skill loads that profile when invoked.
3. The agent generates one profile-compliant response.
4. Deterministic offline checks catch structural regressions during development.

The same profile is designed to travel across Claude Code, Cursor, OpenAI Codex/Responses API, and Pi.

## Install

> [!IMPORTANT]
> **Pre-release:** the skill and installer are not published yet. Packaging and the `npx` installer are planned for **M4**; M1 is building the profile, language rules, and evaluation gates first.

The planned install command is:

```bash
npx im-dumb
```

Non-interactive installs will support:

```bash
npx im-dumb install --targets claude,cursor,pi --scope global
```

| Harness | Global target | Project target |
|---|---|---|
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| Cursor | `~/.cursor/skills/` | `.cursor/skills/` or `.agents/skills/` |
| Pi | `~/.pi/agent/skills/` or `~/.agents/skills/` | `.pi/skills/` or `.agents/skills/` |
| Claude API / claude.ai | Manual upload | — |
| OpenAI hosted | Manual upload or local-shell path | — |

Hosted upload automation is intentionally out of scope for v1 because it would require account credentials.

## Security

- Bundled skill scripts make **no outbound network calls** at invocation time.
- Compiled JavaScript has **zero runtime dependencies**.
- Running `npx im-dumb` (planned, M4) will need network access once, to download the package; after install, the skill's bundled scripts still make no outbound network calls when invoked.
- The installer will only write local files that you can inspect.
- Profile paths can be overridden with `IM_DUMB_PROFILE`; profile validation rejects unknown fields on save.

## M1 evaluation status

M1's implementation and evidence-gathering are complete: the profile module and CLI, deterministic checkers, the golden dataset, the judge rubric, 54 manually captured baseline/candidate responses, and two evidence reports:

- [Token-overhead report](eval/baselines/m1-token-overhead-report.md) — single-trial; corpus aggregate is **-12.56%** against the M1 report-only ceilings, but three individual cases exceed the +60% per-case ceiling.
- [Live spot-check report](eval/baselines/m1-live-spot-check.md) — **0 of 5** golden cases passed the full judge rubric in a single-trial, manual run.

Both reports are single-trial and report-only in M1: they are recorded risk, not blocking gates, and not M3 ground truth. This evidence is not a production-readiness signal — M3 adds a multi-trial, variance-aware, blocking evaluation runner before model-scored behavior gates a release.

How the full stack fits together (Layer 1 checkers, golden dataset, rubrics, M2 runtime evidence) and why those gates are shaped the way they are: [eval/README.md](eval/README.md).

## Development

Requires Node.js 24.12 or newer for stable TypeScript type stripping.

```bash
npm install
npm run build
npm run typecheck
npm test
```

The project uses strict TypeScript, Node’s built-in test runner, Conventional Commit PR titles, and deterministic evaluation fixtures before behavior ships.

## Roadmap

- **M1 — implementation and evidence complete, gates report-only:** profile, language rules, deterministic checkers, golden dataset, and captured evidence (see [M1 evaluation status](#m1-evaluation-status))
- **M2:** comprehension gate and learned gaps
- **M3:** full evaluation runner and human comprehension protocol
- **M4:** multi-harness packaging and `npx` installer
- **M5:** profile-aware learning assets
- **M6:** release and governance hardening

## Why “im-dumb”?

Because “the explanation did not fit me” often gets treated as “I am the problem.” The name makes fun of that failure mode, not the person asking for clarity.

## Contributing

Read [AGENTS.md](AGENTS.md) before changing behavior. Keep PR titles conventional and CI green before merge.
