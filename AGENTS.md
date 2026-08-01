# im-dumb — agent instructions

Cross-harness agent skill (Claude Code, Cursor, OpenAI Codex, Pi) plus an npx installer. The skill shapes LLM responses at generation time to match how an individual user understands language — a personalized communication profile (vocabulary, jargon policy, sentence caps, ADHD mode) plus a comprehension gate that diagnoses confusion with named candidates instead of vague re-asks. This file is the public operating contract; milestone requirements live in `docs/plans/`. A private, gitignored `prd.md` may also be available locally.

## Non-negotiable invariants

1. **Name sync**: the skill directory name and the `name:` field in its `SKILL.md` frontmatter MUST be identical (`im-dumb`, lowercase-hyphenated). Cursor enforces this strictly. If you rename one, rename both.
2. **No network at invocation time**: bundled `scripts/` must never make outbound network calls when the skill runs. Claude API / OpenAI hosted modes disallow network access.
3. **TypeScript only**: all scripts, helpers, and the installer are TypeScript compiled to dependency-free, plain Node-executable JS. No Python. No runtime `npm install` requirements in compiled artifacts.
4. **Description limit**: `SKILL.md` frontmatter `description` stays under 1024 characters and states both *what* the skill does and *when* to trigger it.
5. **Strict SemVer**: package version and skill `metadata.version` follow MAJOR (breaking schema/contract/harness removal), MINOR (new backward-compatible capability), PATCH (fixes/tuning).
6. **Comprehension-gate hard constraints**: at most one clarifying question per turn; never a bare, unscoped "I don't understand" prompt back to the user; second consecutive failure always triggers full re-diagnosis (overrides confidence-based skips).
7. **Evals before implementation**: eval design (golden dataset, deterministic checkers, judge rubric) is defined before the behavior it gates ships (product-requirements §9). Readability scores (Flesch-Kincaid) are supporting signals only, never standalone success measures. No ELO/ranking aggregation in judge scoring.

The product-requirements §9.10 pre-code checklist is satisfied **per-milestone**: each item lands before the behavior it gates ships, not all-before-any-code. Gate-specific eval scaffolds and dataset categories 4–5 (§9.4) land at M2 start; the human comprehension-quiz protocol lands by M3. The "Layer 2 offline eval smoke suite" required PR check is aspirational until M3 delivers the runner — deferral deliberate, not drift.

## Repo layout (actual)

```
docs/plans/         # public milestone requirements and implementation plans
eval/               # eval stack map (README.md), golden dataset, rubrics, baselines, M2 runtime evidence
src/                # profile module, deterministic checkers, CLIs
test/               # node:test suites + fixtures
skill/im-dumb/      # the skill package: SKILL.md + scripts/profile.js + references/
AGENTS.md           # this file
CLAUDE.md           # @AGENTS.md import — do not add content there
README.md           # human-facing overview
```

`installer/` does not exist yet — it is planned for **M4** (multi-harness packaging + `npx` installer); see Milestones below.

## Installer contract (v1 - planned for M4)

- Runnable via `npx im-dumb`, zero global install.
- Auto-detects harnesses: `~/.claude/`/`.claude/` (Claude Code), `~/.cursor/`/`.cursor/` (Cursor), `~/.pi/agent/`/`~/.agents/`/`.pi/`/`.agents/` (Pi), `.codex/` (flagged manual/local-shell only).
- Interactive multi-select of detected harnesses + global/project scope toggle per harness.
- Non-interactive mode: `npx im-dumb install --targets claude,cursor,pi --scope global`.
- Idempotent: detects existing install, diffs version, prompts upgrade — never duplicates.
- Shared-directory aware: prefers write-once to `.agents/skills/im-dumb/` when that convention is in use.
- Out of scope v1: automated upload to Claude API `/v1/skills` or OpenAI hosted skills (manual step, documented).

## Governance

- **PR titles**: valid Conventional Commit headers (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `feat!:`/`BREAKING CHANGE:`). CI lints and blocks on failure. Version bumps derive from this history.
- **CI green before merge** — single override path only (required label + second approver), shared with the eval-gate override.
- **Required PR checks**: PR-title semantic lint, TypeScript build/typecheck, Layer 1 deterministic skill-constraint checks, Layer 2 offline eval smoke suite.
- **Releases are manual**: `workflow_dispatch` workflow computes next SemVer from commit history, runs full nightly eval suite (all five gates, prd.md §9.2) as release-blocking gate, publishes npm, tags, generates changelog, optionally cuts skill-bundle zip for hosted upload. Never auto-publish on merge.

## Milestones (prd.md §12)

M1 profile + language rules → M2 comprehension gate → M3 eval infrastructure (before M4/M5 ship) → M4 multi-harness packaging + installer → M5 learning assets (markdown/html → slides → av) → M6 governance hardening.

## Doc sync rule

`CLAUDE.md` contains only `@AGENTS.md`. All agent-facing instruction changes go here, never there. Keep `README.md`, this file, and the public milestone plans consistent when contracts change; update the private `prd.md` too when it is available locally.
