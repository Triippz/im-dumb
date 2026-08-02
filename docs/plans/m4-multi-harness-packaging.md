# m4 implementation plan, multi-harness packaging + installer

Revision 1, written after the M3 merge (`d5ad12b`); no npm publish in this milestone.

## 1. Overview

**Problem**: The skill package lives in-repo under `skill/im-dumb/`, but users cannot yet install it into Claude Code, Cursor, or Pi via a documented `npx` flow. AGENTS.md still marks `installer/` as planned.

**Approach**: Ship a **dependency-free TypeScript installer CLI** that copies the bundled skill tree into harness skill directories. Prefer the shared `.agents/skills/im-dumb/` write-once path when that convention is already in use. Keep the package `private: true` until release approval, local/`npm link`/`node dist/install-cli.js` verify the contract without publishing.

**In scope (M4)**:
- Public plan (this file)
- Harness auto-detection and installation (claude, cursor, codex, pi)
- Non-interactive install: `im-dumb install --targets … --scope global|project`
- Interactive install when TTY and `--targets` omitted (multi-select + per-harness scope)
- Idempotent copy (same version → no-op; different → upgrade)
- Shared `.agents/skills/` awareness
- `package.json` `bin` + `files` for future publish; skill source remains `skill/im-dumb/`
- Docs: README/AGENTS installer section marked implemented (still unpublished)

**Out of scope (M4)**:
- npm publish / tags / GitHub release (the release path plus explicit approval)
- Hosted Claude API / OpenAI skill upload automation
- Changing skill behavior / profile schema
- learning assets

## 2. Requirements

### Functional

1. **Source of truth**: install from package-local `skill/im-dumb/` (resolved via `import.meta.url`).
2. **Detect**: scan home + project (cwd → git root) for harness markers listed in AGENTS.md.
3. **Install paths** (when not using shared agents):
   - Claude global: `~/.claude/skills/im-dumb`
   - Claude project: `<project>/.claude/skills/im-dumb`
   - Cursor global: `~/.cursor/skills/im-dumb`
   - Cursor project: `<project>/.cursor/skills/im-dumb`
   - Codex global: `$CODEX_HOME/skills/im-dumb` (defaults to `~/.codex/skills/im-dumb`); project scope is rejected until Codex documents a project skill root.
   - Pi global: `~/.pi/agent/skills/im-dumb` (fallback `~/.agents/skills/im-dumb`)
   - Pi project: `<project>/.pi/skills/im-dumb` (fallback `<project>/.agents/skills/im-dumb`)
4. **Shared agents**: if `~/.agents/skills` or `<project>/.agents/skills` already exists (or `--prefer-agents`), write once to `{that}/im-dumb` and skip duplicate per-harness copies for targets that can consume it.
5. **Idempotency**: read installed `SKILL.md` `metadata.version`; equal → skip; missing/different → replace tree.
6. **CLI**: default command installs (interactive or via flags). `im-dumb install …` explicit. Exit 0 on success/no-op; exit 2 on bad args; exit 1 on IO failure.
7. **No network** in the installer itself (only local fs). Package download via `npx` is out-of-band.

### Acceptance criteria

- [x] Plan exists before installer behavior ships.
- [x] Unit tests cover detect, path resolution, shared-agents collapse, idempotent upgrade/no-op (temp dirs; no touching real `~`).
- [x] `npm run build` emits `dist/install-cli.js` with shebang; `node dist/install-cli.js install --help` works.
- [x] Non-interactive install into a temp home/project succeeds and leaves name-sync intact.
- [x] Codex installs into its native `.codex/skills/im-dumb` root.
- [x] AGENTS.md / README updated: installer implemented, still unpublished.
- [x] No npm publish from this PR.

## 3. Layout

```
src/harness-detect.ts   # markers + path resolution
src/install.ts          # copy / upgrade / version parse
src/install-cli.ts      # argv + interactive prompts
docs/plans/m4-…md
test/harness-detect.test.ts
test/install.test.ts
test/install-cli.test.ts
```

`installer/` directory name from early notes is **not** required, CLI lives in `src/` like other tools (ponytail: one tree).

## 4. Decisions

| ID | Decision |
|---|---|
| D1 | Keep `private: true`; add `bin`/`files` now so M6 publish is a toggle + workflow. |
| D2 | Shared `.agents/skills` wins over per-harness duplicates when the directory already exists. |
| D3 | Interactive uses `readline` only; no prompt libraries. |
| D4 | Default scope for non-interactive is `global` when `--scope` omitted (matches AGENTS example). |
| D5 | Skill package stays at `skill/im-dumb/` (not moved under `installer/`). |

## 5. Test plan

- Temp `HOME` + project fixtures for detect/install.
- Version equal → zero file mtime change / action=`skipped`.
- Version bump → overwritten.
- Multi-target + shared agents → one destination recorded for multiple harnesses.
- Bad `--targets` → exit 2.

## 6. Traceability

| AGENTS / prd §10.4 | Delivery |
|---|---|
| `npx im-dumb` | `bin.im-dumb` → `dist/install-cli.js` |
| Auto-detect | `harness-detect.ts` |
| Interactive multi-select + scope | `install-cli.ts` |
| Non-interactive flags | `install --targets --scope` |
| Idempotent upgrade | `install.ts` |
| Shared `.agents/skills` | resolve + collapse |
| Hosted upload OOS | docs only |
