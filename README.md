# im-dumb

An agent skill that shapes LLM responses at generation time to match how *you* actually understand language — your vocabulary, your jargon tolerance, your structure preferences — configured once and applied everywhere. Installable across four harnesses — Claude (Claude Code / Claude API / claude.ai), Cursor, OpenAI Codex/Responses API, and Pi — from a single skill directory targeting the open Agent Skills standard, plus an `npx` installer that puts it where each harness expects it.

## What it does

- **Personalized communication profile** — a short onboarding flow produces a portable global config (vocabulary level, jargon policy, sentence-length cap, tone, output shape) that is applied automatically at generation time.
- **ADHD mode** — restructures responses (answer-first, 2–3 item chunks, explicit segment boundaries) rather than just shortening them. A communication accommodation, not a medical feature.
- **Comprehension gate** — when you say "I don't get it," it names 2–4 concrete candidates for what likely confused you (a term, a step, the framing) instead of asking a vague "what didn't you understand?" Resolved confusions update your profile, so it stops re-asking and just applies the fix.
- **Learning assets** (post-launch) — Markdown/HTML explainers, then slides, then audio/video, all respecting the same profile constraints.

Rule design is grounded in ASD-STE100 Simplified Technical English, cognitive load theory, plain-language research, and clarification-dialogue research — see [prd.md](prd.md) §4.

## Why one skill directory works everywhere

All four harnesses implement (or converge on) the same convention: a directory containing a `SKILL.md` with YAML frontmatter (`name`, `description`) and a markdown instruction body, optionally bundled with scripts and references, loaded into context only when triggered (progressive disclosure). See [prd.md](prd.md) for the full per-harness compatibility analysis.

## Install

Development requires Node.js 24.12 or newer (stable TypeScript type stripping).

> **Status: pre-release.** M1 (profile + language rules) in progress; the installer ships at M4 and nothing is published to npm yet. Sections below describe the target behavior.

```bash
npx im-dumb
```

The installer auto-detects installed harnesses (Claude Code, Cursor, Pi; Codex flagged as a manual step), presents a multi-select with a global/project scope toggle, and writes the skill files locally for you to review. Beyond fetching the npm package itself, the installer performs no secondary remote fetch-and-execute, and the skill makes no network calls at invocation time.

Non-interactive (CI/dotfiles):

```bash
npx im-dumb install --targets claude,cursor,pi --scope global
```

If a shared `.agents/skills/` directory is already in use, the installer offers a single write there instead of per-harness copies.

### Install locations

| Harness | Global | Project |
|---|---|---|
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| Cursor | `~/.cursor/skills/` | `.cursor/skills/` (or shared `.agents/skills/`) |
| Pi | `~/.pi/agent/skills/`, `~/.agents/skills/` | `.pi/skills/`, `.agents/skills/` |
| Claude API / claude.ai | manual upload (`/v1/skills` / zip) | — |
| OpenAI hosted | manual upload / local shell path config | — |

Hosted-API upload automation is deliberately out of scope for v1 — it requires your own API credentials and a reviewed, account-scoped action.

## Security posture

- Installer only writes local files you can inspect before first run — beyond fetching the npm package itself, no secondary remote fetch-and-execute.
- Bundled scripts make **no outbound network calls** at skill-invocation time (required for Claude API / OpenAI hosted compatibility, and good hygiene everywhere).
- All scripts are TypeScript compiled to dependency-free JS — no runtime package installation needed on any harness.

## Versioning & releases

Strict SemVer, derived from Conventional Commit PR titles. Releases are manually triggered (`workflow_dispatch`), gated on the full eval suite — a version number is never assigned to code that hasn't passed the full sweep. Details in [prd.md](prd.md).

## Contributing

Agent-facing repo rules live in [AGENTS.md](AGENTS.md) (mirrored to `CLAUDE.md` via import). PR titles must be valid Conventional Commit headers; CI must be green before merge.
