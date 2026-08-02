# m6 implementation plan, release and governance hardening

Revision 1, prior merge (`8fbbbbd`). No package is published by this milestone.

## 1. Overview

**Problem**: Every milestone through M5 is merged, but there is no release path. Versions are hand-edited, there is no changelog, and the AGENTS.md governance section describes a `workflow_dispatch` release that does not exist.

**Approach**: Derive the version from Conventional Commit history (the PR-title lint already guarantees that history is well-formed), keep the release manual, and make the full offline suite a release-blocking gate. Publishing stays opt-in behind two separate workflow inputs.

**In scope (M6)**:
- Public plan (this file)
- `src/release-version.ts`, bump derivation, SemVer math, changelog rendering
- `src/release-cli.ts`, dry-run by default, `--write` applies version + changelog
- `.github/workflows/release.yml`, `workflow_dispatch` only, gated, dry-run default
- `CHANGELOG.md` seeded on first real release
- Documented override path for a red gate

**Out of scope (M6)**:
- Actually publishing to npm, tagging, or cutting a GitHub release
- Flipping `private: true` to public
- Hosted Claude API / OpenAI skill upload automation
- Gate 5 shadow/canary, needs live traffic to shadow; unbuilt until the skill has users

## 2. Requirements

### Functional

1. **Bump derivation**: `feat` → minor, `fix`/`docs`/`chore`/`refactor`/`test` → patch, `!` or `BREAKING CHANGE:` → major. Highest bump across the range wins. No conventional commits → no release (exit 1).
2. **Range**: last `v*` tag to `HEAD`; whole history when no tag exists yet.
3. **Version sync**: a release writes the same version to `package.json` and the skill's `metadata.version`, then re-runs `verify:dist-sync`.
4. **Changelog**: grouped by Breaking changes / Features / Fixes / Other, newest section first, scopes rendered as `**scope:**`.
5. **Release gate**: build, typecheck, tests, golden verify, dist-sync, skill check, and Layer 2 dry-run smoke all pass before anything is written. Live judge smoke also runs when `JUDGE_SMOKE_ENABLED=true`.
6. **Manual only**: `workflow_dispatch`, `dry_run` defaults to true, `publish_npm` defaults to false and is a second explicit opt-in.

### Acceptance criteria

- [x] Plan lands before the release path ships.
- [x] Bump/SemVer/changelog logic is unit-tested, including the no-release case.
- [x] `npm run release:prepare` is a dry run and prints the computed version and changelog preview.
- [x] Release workflow is `workflow_dispatch` only and never triggers on merge.
- [x] Publishing requires both `dry_run: false` and `publish_npm: true`.
- [x] Governance docs describe the override path.
- [ ] A real release is cut (deliberately deferred, needs owner approval).

## 3. Override path

CI green is required before merge. There is exactly one override, shared by the
CI gate and the eval gate:

1. Apply the `override-gate` label to the PR, with a comment naming the failing
   check and why shipping is safer than waiting.
2. Get a second approving review from someone who did not write the change.
3. The override is per-PR. It never carries forward, and it never applies to a
   release run, a red release gate is always a stop.

## 4. Decisions

| ID | Decision |
|---|---|
| D1 | Version is derived, never hand-typed. The PR-title lint is what makes this safe. |
| D2 | `release:prepare` is dry-run by default; `--write` is the only mutating path. |
| D3 | Publishing needs two separate opt-ins so a single mis-click cannot publish. |
| D4 | The skill bundle zip is uploaded as a workflow artifact, not attached to a release, since hosted upload stays manual. |
| D5 | No release automation on merge, ever. |

## 5. Traceability

| AGENTS governance line | Delivery |
|---|---|
| Version bumps derive from commit history | `parseConventionalSubjects` + `computeNextVersion` |
| Manual `workflow_dispatch` release | `.github/workflows/release.yml` |
| Full suite as release-blocking gate | gate steps before the version step |
| Generates changelog | `renderChangelogSection` + `--write` |
| Optional skill-bundle zip | `Cut skill bundle` step |
| Never auto-publish on merge | no `push`/`pull_request` trigger |
| Single override path | §3 above |
