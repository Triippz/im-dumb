# im-dumb, agent instructions

Cross-harness agent skill (Claude Code, Cursor, OpenAI Codex, Pi) plus an npx installer. The skill shapes LLM responses at generation time to match how an individual user understands language, a personalized communication profile (vocabulary, jargon policy, sentence caps, ADHD mode) plus a comprehension gate that diagnoses confusion with named candidates instead of vague re-asks. This file is the public operating contract; milestone requirements live in `docs/plans/`. A private, gitignored `prd.md` may also be available locally.

## Non-negotiable invariants

1. **Name sync**: the skill directory name and the `name:` field in its `SKILL.md` frontmatter MUST be identical (`im-dumb`, lowercase-hyphenated). Cursor enforces this strictly. If you rename one, rename both.
2. **No network at invocation time**: bundled `scripts/` must never make outbound network calls when the skill runs. Claude API / OpenAI hosted modes disallow network access.
3. **TypeScript only**: all scripts, helpers, and the installer are TypeScript compiled to dependency-free, plain Node-executable JS. No Python. No runtime `npm install` requirements in compiled artifacts.
4. **Description limit**: `SKILL.md` frontmatter `description` stays under 1024 characters and states both *what* the skill does and *when* to trigger it.
5. **Strict SemVer**: package version and skill `metadata.version` follow MAJOR (breaking schema/contract/harness removal), MINOR (new backward-compatible capability), PATCH (fixes/tuning).
6. **Comprehension-gate hard constraints**: at most one clarifying question per turn; never a bare, unscoped "I don't understand" prompt back to the user; second consecutive failure always triggers full re-diagnosis (overrides confidence-based skips).
7. **Evals before implementation**: eval design (golden dataset, deterministic checkers, judge rubric) is defined before the behavior it gates ships. Readability scores (Flesch-Kincaid) are supporting signals only, never standalone success measures. No ELO/ranking aggregation in judge scoring.

The pre-code eval checklist is satisfied incrementally: each item lands before the behavior it gates ships, not all-before-any-code. A gate's eval scaffold and its golden dataset categories land before that gate does; the human comprehension-quiz protocol lives under `eval/quiz/`. Layer 2 dry-run smoke (`npm run eval:smoke`) is a required CI step; live pinned-judge smoke runs only when `JUDGE_SMOKE_ENABLED` and judge secrets are configured.

## Repo layout (actual)

```
docs/plans/         # public milestone requirements and implementation plans
eval/               # eval stack map (README.md), golden dataset, rubrics, baselines, comprehension-gate runtime evidence (cohorts are per-model evidence, not CI gates)
src/                # profile module, deterministic checkers, CLIs
test/               # node:test suites + fixtures
skill/im-dumb/      # the skill package: SKILL.md + scripts/profile.js + references/
AGENTS.md           # this file
CLAUDE.md           # @AGENTS.md import, do not add content there
README.md           # human-facing overview
```

There is no separate `installer/` package directory, the CLI lives in `src/install-cli.ts` (built to `dist/install-cli.js`) and copies `skill/im-dumb/`. Publication happens only through an owner-authorized manual release run, never on merge; local verify via `npm run build && node dist/install-cli.js install …` or `npm run install:skill -- --targets …`.

## Installer contract (v1, implemented, unpublished)

- Bin entry `im-dumb` → `dist/install-cli.js` (ready for `npx` once published).
- Auto-detects harnesses: `~/.claude/`/`.claude/` (Claude Code), `~/.cursor/`/`.cursor/` (Cursor), `$CODEX_HOME` (defaults to `~/.codex/`) (Codex), and `~/.pi/agent/`/`~/.agents/`/`.pi/`/`.agents/` (Pi).
- Interactive prompts when TTY and `--targets` omitted; one global/project `--scope` for the run, except Codex is global-only until it documents a project skill root.
- Non-interactive mode: `im-dumb install --targets claude,cursor,codex,pi --scope global`.
- Idempotent: detects existing install, diffs `metadata.version`, upgrades, repairs, or skips, never duplicates.
- Shared-directory aware: when `.agents/skills/` exists (or `--prefer-agents`), cursor+pi write once there; Claude and Codex still use native roots.
- Out of scope v1: automated upload to Claude API `/v1/skills` or OpenAI hosted skills (manual step, documented).
- `im-dumb init` writes per-repo always-on rule files (`.cursor/rules/im-dumb.mdc` with `alwaysApply: true`, plus an appended block in `AGENTS.md`). Skills load per turn at the model's discretion; rule files do not, so this is what makes the profile apply without the skill being selected. The rule body points at `profile.js load` and never materializes profile values, so it cannot go stale. Idempotent by a sentinel string, and a user-edited rule file is skipped without `--force`.

## Enhanced mode (optional, Pi only)

`src/pi-extension.ts` (built to `dist/pi-extension.js`, registered through the `pi.extensions` field) appends the active profile to the system prompt on every `before_agent_start`. It raises per-turn adherence; it is **never** a correctness prerequisite, and the skill stays fully functional on every harness without it. A missing or unreadable profile returns no override, so a profile failure never blocks a turn. Claude, Cursor, and Codex get a weaker session-hook form later, their hooks run before generation, so they are the same class as prompt text. No mechanism on any harness guarantees exact output; enforcement stays in the Layer 1 checkers.

## Governance

- **PR titles**: valid Conventional Commit headers (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `feat!:`/`BREAKING CHANGE:`). CI lints and blocks on failure. Version bumps derive from this history.
- **CI green before merge**, single override path only: the `override-gate` label plus a second approving review from someone who did not write the change, per-PR, never carried forward, and never valid for a release run. Shared with the eval-gate override; the release governance plan documents it.
- **Required PR checks**: PR-title semantic lint, TypeScript build/typecheck, Layer 1 deterministic skill-constraint checks, Layer 2 offline eval smoke suite.
- **Releases are manual**: `.github/workflows/release.yml` is `workflow_dispatch` only. It computes the next SemVer from Conventional Commit history (`src/release-version.ts`), runs the full offline suite as a release-blocking gate, then writes `package.json` + skill `metadata.version` + `CHANGELOG.md`, tags, and uploads a skill-bundle zip artifact. `dry_run` defaults to true and npm publish needs a second explicit `publish_npm` opt-in, so nothing ships by accident. Never auto-publish on merge. `npm run release:prepare` is the local dry run.

## Learning assets

Markdown and HTML explainers and HTML slide decks are shipped: `skill/im-dumb/references/learning-assets.md`, the `learning-asset` Layer 1 structure checker, and the `learning-asset` golden category. A slide deck is HTML, one `<article>`, at least two `<section class="slide">`, each with its own heading. There is no PowerPoint binary output. Audio and video are out of scope, bundled generation needs TTS/ffmpeg, which collides with the no-network and dependency-free invariants; a host integration calling an external generator is a stretch goal, not planned work.

The SKILL.md body target is 900 words. The comprehension non-trigger examples and the no-snapshot fallback live in `references/comprehension.md`, which is only read once repair is in play. The checker's warn threshold stays 1000. Prefer moving prose into `references/` over raising the target, only rules needed on *every* turn belong in the always-loaded body.

## Writing rules

**No planning coordinates.** Never cite internal planning coordinates in repo content: milestone IDs, phase numbers, task or step numbers, decision IDs, PR numbers, GitHub issue numbers. They are positions in a plan, not facts about the software, and they go stale the moment the plan moves. Describe the behavior, the constraint, or the reason instead. "The installer is unpublished" survives; "the next milestone publishes it" does not. This covers shipped skill text, `README.md`, this file, source comments, test names, and commit and PR bodies. Three trees are exempt because their numbering is load-bearing: `docs/plans/` is the planning record, `docs/adr/` numbers its own decisions, and `eval/` pins rubric and decision IDs that immutable attempt history already cites. Hashed or captured artifacts under `eval/` are never edited for style at all, since their bytes feed a manifest hash. Nothing outside those trees may cite their numbering, and nothing anywhere may cite a PR or issue number.

**No em dashes.** Use a comma, a colon, or two sentences. This applies to prose you write in this repo and to prose the skill tells a model to produce.

## Doc sync rule

`CLAUDE.md` contains only `@AGENTS.md`. All agent-facing instruction changes go here, never there. Keep `README.md`, this file, and the public plans consistent when contracts change; update the private `prd.md` too when it is available locally.
