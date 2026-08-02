# cross-harness reset — research plan

Status: **steps 1–6 shipped** (#42, #43, #44). Script paths are rewritten after
install, installed trees are verified across the four native roots, Codex
installs globally, the fixture-specific prompt steering is reverted, and the
cohort is per-model evidence behind a `k`-of-`n` threshold, and Pi has an
optional enhanced mode.

Scope: answer the six questions in `/tmp/im-dumb-handoff-cross-harness.md` §3
with local, citable evidence, and propose the compatibility matrix that §4
defers until after user review.

Frame: `im-dumb` is a portable skill for Claude Code, Cursor, OpenAI Codex, and
Pi. PRs #26–#41 drifted into tuning shipped prompt text against one sampled
generator (`openai-codex/gpt-5.6-sol`). The correction is architectural — decide
what a prompt can promise, and put everything else behind code — not another
prompt edit.

---

## 0. Evidence base

Everything cited below was read directly during this research pass.

| Source | Path |
|---|---|
| Shipped skill body | `skill/im-dumb/SKILL.md` |
| Comprehension reference | `skill/im-dumb/references/comprehension.md` |
| Bundled script | `skill/im-dumb/scripts/profile.js` |
| Harness detection | `src/harness-detect.ts` |
| Layer 1 checkers | `src/checkers.ts`, `src/comprehension-gate-checker.ts` |
| Cohort gate (PR #40/#41) | `src/m2-cohort.ts`, `eval/runtime/evaluate-m2-cohort.ts`, `test/m2-cohort.test.ts` |
| Cohort policy prose | `eval/runtime/README.md` |
| Packaging plan | `docs/plans/m4-multi-harness-packaging.md` |
| M1 decisions D4/D9/D10/D12/D15 | `docs/plans/m1-profile-and-language-rules.md` |
| Eval layer map | `eval/README.md` |
| Ponytail package | `~/.pi/agent/npm/node_modules/@dietrichgebert/ponytail/` |
| Caveman repo/marketplace | `~/.claude/plugins/marketplaces/caveman/` |
| Cursor skill-authoring contract | `~/.cursor/skills-cursor/create-skill/SKILL.md` |
| Codex skill installer contract | `~/.codex/skills/.system/skill-installer/SKILL.md` |
| Codex plugin contract | `~/.codex/skills/.system/plugin-creator/SKILL.md` |
| Pi package loading | `~/.pi/agent/settings.json`, ponytail `package.json` `pi` block |
| Shared skills convention | `~/.agents/skills/`, `~/.agents/.skill-lock.json` |

---

## 1. What a pure `SKILL.md` can and cannot promise

A `SKILL.md` is text injected into a model's context. It has no execution
privilege over the model's sampler. Every promise it makes is a probability,
not a guarantee — and the probability differs per model, per harness system
prompt, and per temperature.

### 1.1 Can promise (structural, harness-side, verifiable without a model)

| Promise | Why it holds | Evidence |
|---|---|---|
| The skill is discoverable by name and description | All four harnesses index `SKILL.md` frontmatter | §3 below |
| Frontmatter fields are valid and within limits | Static file property; `checkSkillFrontmatter` already gates it | `src/checkers.ts:471` |
| Directory name matches `name:` | Static file property; Cursor enforces | `AGENTS.md:7`; Cursor `name` rules at `~/.cursor/skills-cursor/create-skill/SKILL.md:96` |
| Body stays inside a token budget | Static; warn >1000 words per D12 | `src/checkers.ts:53`, `docs/plans/m1-profile-and-language-rules.md:104` |
| References exist and are reachable from the skill root | Static tree property | `skill/im-dumb/references/` |
| The bundled script is the only script and makes no network calls | Static; already asserted | `test/skill.test.ts:317`; AGENTS invariant 2 |
| The script's own I/O contract (exit codes, stdout JSON, atomic save) | Runs in Node, not the model | D15, `docs/plans/m1-profile-and-language-rules.md:107` |

### 1.2 Cannot promise (model-generated prose)

A pure `SKILL.md` **cannot** guarantee, on any single sample from any model:

- an exact first line (`**Likely confusion points**`);
- an exact literal token surviving into an answer (`new app`, `check`,
  `hostile`, `incoming requests`);
- an exact candidate count (four, not three);
- a hard sentence-length cap on every sentence;
- a single `?` in the whole response;
- one-term-per-concept across a long answer;
- the absence of a specific preamble ("Diagnosing…", "I'll load…").

These are exactly the properties PRs #27, #29–#39 kept tightening. The cohort
result in the handoff is the proof: attempts 41–44 were deterministic
hard-clean, attempt 40 failed two deterministic prose checks (sentence cap,
one-term terminology) — **same commit, same model, same harness**. That is
sampling variance, not a prompt defect. No further prompt wording removes it.

### 1.3 The dividing line

> A skill can promise **what is in the file**. It can only *bias* **what comes
> out of the model**.

Everything in §1.2 is an output property. If any of them is a hard release
requirement, it needs a host-level mechanism (§4) — not a stronger sentence in
`SKILL.md`.

### 1.4 One concrete portability defect found

`skill/im-dumb/SKILL.md:11` instructs: run `node scripts/profile.js load`.
That is a **relative path**. Nothing in the repo resolves it against the
installed skill directory — `grep` for `cwd`, `SKILL_DIR`, `CLAUDE_PLUGIN_ROOT`,
or "absolute path" across `skill/`, `docs/plans/`, `README.md`, and `AGENTS.md`
returns only an unrelated installer-detection line
(`docs/plans/m4-multi-harness-packaging.md:33`), and `profile.js` never reads
`process.cwd()`.

In every harness the shell's working directory is the **user's project root**,
not `~/.claude/skills/im-dumb/`. So `node scripts/profile.js load` fails with
`MODULE_NOT_FOUND` unless the model independently guesses the install path —
which differs per harness and per scope (§6). The same applies to the
`save`/`validate`/`learn` invocations at `references/onboarding.md:36,39,65`
and `references/comprehension.md:224`.

Note the asymmetry: harnesses *do* resolve **reference reads** relative to the
skill root (Cursor documents `[reference.md](reference.md)` as the progressive
disclosure idiom — `create-skill/SKILL.md` "Progressive Disclosure"), but they
do **not** rewrite the cwd for **shell commands**. Reference resolution and
script invocation are two different mechanisms, and the skill currently treats
them as one.

This is a higher-severity, more portable-impact bug than anything PRs #26–#41
addressed, and it was never surfaced because M2 captures ran through a bespoke
harness (`eval/runtime/capture-m2.ts`) rather than a real install.

---

## 2. Deterministic checks/scripts vs advisory skill text

Test for placement: **if a machine can decide it without sampling a model, a
machine must decide it.** Prompt text then exists only to raise the odds, never
to serve as the gate.

### 2.1 Already deterministic — keep, and stop re-encoding in prose

`src/checkers.ts:13` ships ten checker ids: `sentence-cap`,
`forbidden-phrases`, `one-term-one-concept`, `output-shape`, `adhd-structure`,
`frontmatter`, `profile-schema`, `golden-case-schema`, `comprehension-gate`,
`learning-asset`. `src/comprehension-gate-checker.ts` owns the diagnosis
heading, deny sets, and question counting.

The drift pattern in PRs #29–#39 was to restate a checker's rule as ever more
specific prose in `references/comprehension.md`. That adds context cost and
model-specific brittleness while adding zero enforcement. The checker was
already the gate.

### 2.2 Should become deterministic (currently advisory prose only)

| Requirement | Today | Proposed |
|---|---|---|
| Script path resolves in every harness | Relative path in prose (`SKILL.md:11`) | Script self-locates; prose stops carrying a path — §4.1 |
| Skill tree is complete and internally consistent after install | Not checked post-install | A `verify` subcommand on the bundled script (offline, no network) |
| References resolve from the skill root | Implicit | Layer 1 link check over `SKILL.md` + `references/**` |
| Reference-classifier decisions (marker vs non-marker) | Repo-only classifier (`src/reference-classifier.ts`); prose warns it is "repository-only" (`references/comprehension.md:23`) | Keep repo-only, but stop paraphrasing its table into prose that reads as a runtime guarantee |

### 2.3 Must stay advisory (model-generated prose)

Everything in §1.2. These belong in `SKILL.md` as **general, model-neutral
rules** and in the eval stack as **distributional** measurements — pass rate
across N samples with a stated threshold — never as a single-sample gate.

The current `eval/README.md` layering already says this: "Code answers (1). A
pinned rubric answers (2). Preserved runtime captures answer (3). Mixing those
layers is how false confidence appears." PRs #34–#39 mixed them, by using a
single runtime capture's prose failure to justify a shipped prompt edit.

### 2.4 Rule to adopt

> A runtime capture failure may open an investigation. It may **not**, by
> itself, authorize a change to shipped skill text. A shipped-text change needs
> a stated, model-neutral reason — plus a golden case, not an attempt number.

---

## 3. How each harness discovers skills and resolves references

### 3.1 Claude Code

**Discovery.** Two paths.

1. Loose skills: `~/.claude/skills/<name>/SKILL.md` (global) or
   `.claude/skills/<name>/SKILL.md` (project). Both directories exist locally
   (`~/.claude/skills/`).
2. Plugins: a marketplace repo with `.claude-plugin/marketplace.json` and
   `.claude-plugin/plugin.json`. Caveman ships both
   (`~/.claude/plugins/marketplaces/caveman/.claude-plugin/plugin.json`,
   `…/marketplace.json`); the plugin declares `skills/` alongside `agents/` and
   `commands/`. Install is `claude plugin marketplace add <owner>/<repo> &&
   claude plugin install <plugin>@<marketplace>`
   (`~/.claude/plugins/marketplaces/caveman/INSTALL.md`, per-agent table).

**Reference resolution.** Relative to the skill directory. `references/*.md`
reads work.

**Script invocation.** cwd is the project root. Plugins get
`${CLAUDE_PLUGIN_ROOT}` substituted in hook commands — see caveman's
`plugin.json` `hooks.SessionStart[].hooks[].command` and ponytail's
`hooks/claude-codex-hooks.json`. **Loose skills get no such variable.** This is
the mechanism gap behind §1.4.

**Hooks.** `SessionStart`, `SubagentStart`, `UserPromptSubmit` (ponytail
`hooks/claude-codex-hooks.json`); caveman adds a statusline
(`src/hooks/caveman-statusline.sh`).

### 3.2 Cursor

**Discovery.** `~/.cursor/skills/<name>/SKILL.md` (personal) or
`.cursor/skills/<name>/SKILL.md` (project) —
`~/.cursor/skills-cursor/create-skill/SKILL.md`, "Storage Locations" table.
`~/.cursor/skills-cursor/` is **reserved for Cursor built-ins and managed
automatically**; the same file says never write there. Local state confirms it:
`~/.cursor/skills-cursor/.sync-manifest.json` is a machine-maintained inventory.

**Frontmatter contract.** `name` max 64 chars, lowercase letters/numbers/
hyphens only; `description` max 1024 chars, non-empty; optional
`disable-model-invocation`, which Cursor recommends defaulting to `true` so a
skill loads only when named. This is the strictest name/description contract of
the four and is the reason AGENTS invariant 1 and invariant 4 exist.

**Reference resolution.** Documented and supported: the canonical layout is
`SKILL.md` + `reference.md` + `examples.md` + `scripts/`, with progressive
disclosure via relative markdown links. Body target: under 500 lines.

**Script invocation.** Cursor explicitly supports a `scripts/` subdirectory in
a skill, but supplies no skill-root variable. Same cwd problem.

**Hooks.** `~/.cursor/hooks.json` — event names differ entirely from Claude's
(`afterAgentResponse`, `afterAgentThought`, `afterFileEdit`,
`beforeMCPExecution`, `beforeReadFile`). A Claude hook config is not portable
here.

**Note for `im-dumb`:** `disable-model-invocation: true` is Cursor's
*recommended default*, and it is incompatible with `im-dumb`'s core premise
(`SKILL.md:3` says "Trigger at the start of each response"). The skill must
deliberately **omit** the field, and the compatibility matrix should record
that ambient triggering on Cursor is a non-default posture.

### 3.3 OpenAI Codex

**This is the finding that most changes the current plan.**
`docs/plans/m4-multi-harness-packaging.md:24` says "Codex auto-install (detect +
document only)", and `src/harness-detect.ts:62` throws
`codex is detect-only in v1; install manually for local-shell mode`.

Local evidence contradicts that as a present-day constraint:

- `~/.codex/skills/` exists and holds hundreds of installed skills, each a
  `<name>/SKILL.md` directory, several with `scripts/` and `references/`
  subdirectories (`~/.codex/skills/impeccable/scripts`,
  `~/.codex/skills/graphify/references`, and others).
- Codex ships a **system skill installer**:
  `~/.codex/skills/.system/skill-installer/SKILL.md` documents "Installs into
  `$CODEX_HOME/skills/<skill-name>` (defaults to `~/.codex/skills`)", with
  `scripts/install-skill-from-github.py --repo <owner>/<repo> --path <path>`.
- Codex has a **plugin system**: `~/.codex/skills/.system/plugin-creator/SKILL.md`
  requires `.codex-plugin/plugin.json`, with a personal marketplace at
  `~/.agents/plugins/marketplace.json`. `~/.codex/plugins/` exists locally with
  marketplace staging directories.
- Codex supports **hooks**: caveman ships `.codex/config.toml` containing
  `[features]\nhooks = true` plus `.codex/hooks.json` with a `SessionStart`
  matcher — the same event vocabulary as Claude. Ponytail documents
  `codex plugin marketplace add …` then `/plugins` and `/hooks`
  (`~/.pi/agent/npm/node_modules/@dietrichgebert/ponytail/README.md`).

**Consequence.** Codex belongs in the installable set, and the sandbox caveat
in AGENTS invariant 2 ("no network at invocation time") is satisfied by
`profile.js` already. Codex's own installer skill notes network-using scripts
need sandbox escalation — `im-dumb`'s does not, which is an advantage worth
stating.

### 3.4 Pi

**Discovery.** Two paths.

1. Loose skills: `~/.pi/agent/skills/<name>/` (populated locally).
2. npm packages listed in `~/.pi/agent/settings.json` under `packages`, e.g.
   `"npm:@dietrichgebert/ponytail"`. The package opts in via a top-level `pi`
   block in its `package.json`:

   ```json
   "pi": { "extensions": ["./pi-extension/index.js"], "skills": ["./skills"] }
   ```

   (ponytail `package.json`). Install: `pi install git:github.com/<owner>/<repo>`
   (ponytail README, "Pi agent harness").

**Reference resolution.** Relative to the skill directory, same as the others.

**Script invocation.** Same cwd caveat.

**Extensions.** Pi is the only one of the four with a first-class **in-process
extension API**: `~/.pi/agent/extensions/` plus the `pi.extensions` package
field. Ponytail's `pi-extension/index.js` uses `pi.registerCommand`,
`pi.appendEntry`, `pi.sendUserMessage`, and `ctx.ui.setStatus` — it can inject
per-turn instructions and read session state. This is the strongest host-level
lever available to a portable skill, and the only one that can shape output
*without* a separate model call.

### 3.5 Shared `.agents/` convention

`~/.agents/skills/` exists locally with `~/.agents/.skill-lock.json`
(`"version": 3`, entries carrying `source`, `sourceType`, `sourceUrl`,
`skillPath`, `skillFolderHash`, `installedAt`, `updatedAt`) — the lockfile
format of the `npx skills` CLI (`vercel-labs/skills`). Caveman ships the same
convention in-repo as `skills-lock.json` (`"version": 1`), and its INSTALL.md
routes roughly 25 harnesses through `npx skills add JuliusBrussee/caveman -a
<profile>`.

`src/harness-detect.ts:70-84` already prefers `.agents/skills/` when present
and correctly excludes Claude from it. That logic is sound and should be
retained.

### 3.6 Discovery/reference summary

| Harness | Global skill root | Project skill root | Refs relative to skill dir | Skill-root var for shell | Hook events |
|---|---|---|---|---|---|
| Claude Code | `~/.claude/skills/` | `.claude/skills/` | yes | plugins only (`${CLAUDE_PLUGIN_ROOT}`) | `SessionStart`, `SubagentStart`, `UserPromptSubmit` |
| Cursor | `~/.cursor/skills/` | `.cursor/skills/` | yes | none found | `afterAgentResponse`, `beforeReadFile`, … (own vocabulary) |
| Codex | `$CODEX_HOME/skills/` (defaults to `~/.codex/skills/`) | not documented; installer rejects project scope | yes | plugins only (`.codex-plugin/`) | `SessionStart` (needs `[features] hooks = true`) |
| Pi | `~/.pi/agent/skills/` or package `pi.skills` | `.pi/skills/` | yes | extension resolves its own path | extension API (not hooks) |
| Shared | `~/.agents/skills/` | `.agents/skills/` | yes | none | n/a |

---

## 4. Is a host extension/wrapper needed?

Two separate questions. They have different answers.

### 4.1 For the script-path defect — **no extension needed**

Fix it in the script, not the host. `profile.js` already imports
`pathToFileURL` and uses `import.meta.url` for its direct-execution guard
(`skill/im-dumb/scripts/profile.js:849`). The same `import.meta.url` gives the
script its own absolute location, so it can locate the skill root itself.

The prose fix is to stop shipping a relative path and instead instruct the
model to invoke the script by the path the harness gave it when it loaded the
skill — plus a documented fallback search order over the §3.6 roots. This is a
few lines, no new dependency, no host integration, and it works identically on
all four harnesses.

Skipped: a per-harness launcher shim. Add one only if a harness is found that
hides the skill's absolute path from the model.

### 4.2 For exact-output requirements — **yes, and only Pi can do it today**

If "the first line is exactly `**Likely confusion points**`" is a hard release
requirement, no prompt satisfies it. The mechanisms that could, ranked by
portability:

| Mechanism | Can enforce exact output? | Portability | Evidence |
|---|---|---|---|
| Prompt text | No — bias only | All four | §1.2 |
| Per-turn instruction injection (Pi extension) | Strongly biases; still no hard guarantee | Pi only | ponytail `pi-extension/index.js` |
| Session/prompt hooks (Claude, Codex, Cursor) | No — they run *before* generation, so they inject context, same class as prompt | Claude + Codex + Cursor (three different configs) | caveman `plugin.json`, `.codex/hooks.json`; ponytail `hooks/claude-codex-hooks.json`, `hooks/copilot-hooks.json` |
| Post-generation rewrite (MCP middleware / response filter) | Yes — this is the only mechanism that *can* | Caveman's `caveman-shrink` MCP proxy is **opt-in** and wraps an upstream MCP server, not the assistant's own response | `~/.claude/plugins/marketplaces/caveman/src/mcp-servers/caveman-shrink`, INSTALL.md `--with-mcp-shrink` |

Note what caveman and ponytail — the two most widely ported skills on this
machine — actually do: **neither enforces exact output.** Both ship hooks that
*re-inject the ruleset* every session and every prompt, and both accept
probabilistic prose. Caveman's `.codex/hooks.json` command is literally an
`echo` of the ruleset. That is the state of the art for portable behavior
skills.

**Recommendation.** Drop exact-output enforcement as a product requirement.
Replace it with:

1. A **distributional** prose gate — pass rate across N samples against a
   stated threshold, reported per model, never a single-sample hard gate.
2. Optional, clearly-labelled **enhanced mode** per harness (Pi extension
   first, since Pi already has the API and ponytail proves the pattern), which
   re-injects the active rules per turn. Enhanced mode raises the pass rate; it
   is never a correctness prerequisite, and the skill must be fully functional
   without it.

This also removes the AGENTS invariant 2 tension: a Pi extension is a host
integration, not a bundled skill script, so the no-network-at-invocation rule
is unaffected.

---

## 5. PR #26–#41 review — revert, retain, generalize

Sixteen merged PRs. Grouped by what the change actually was.

### 5.1 Revert — fixture-specific prompt steering in shipped skill text

These encode the wording of specific golden/runtime scenarios into text that
ships to every user on every turn. They are the drift the handoff names.

| PR | Change | Where | Why revert |
|---|---|---|---|
| #37 | `retain \`new app\` and \`check\` exactly when supplied` appended to the `step` repair row | `references/comprehension.md:217` | Two literals from one scenario, in the shipped gap taxonomy |
| #39 | "For a queue answer with adding, oldest selection, completion, and a concrete example, emit all four." | `references/comprehension.md:108` | Names one fixture's domain and its exact candidate count |
| #31/#33 | "If it is a distribution proposition, exclude divide, distribute, spread, route, and equivalents"; "For a failed distribution repair with four remaining paths, use request, server selection, stated speed, and failure availability." | `references/comprehension.md:113-117` | A per-scenario answer key, not a rule |
| #29 | "write `incoming requests`, never 'what someone sends when using a website.'" | `references/comprehension.md:103-104` | Verbatim fixture phrasing as a shipped example |
| #33 | "Do not turn `process` into `succeeds` unless the prior answer says so." | `references/comprehension.md:110-111` | Token-level steering from one capture |
| #27/#35 | The `SKILL.md:41-45` block: "A first exact `huh` must diagnose"; "first line `**Likely confusion points**` or `{`"; "Forbidden before that line: Diagnosing, I'll load, loading your profile, Active repair thread" | `SKILL.md:41-45` | Model-output steering in the always-loaded body; `comprehension-gate-checker.ts` already owns the heading and deny sets (`src/comprehension-gate-checker.ts:34`) |
| #32 | "If four explicit distinct paths exist, emit four: use an unused fourth slot for a stated benefit, condition, or consequence." | `references/comprehension.md:166-168` | Count-forcing; duplicates the existing "cover every materially distinct supported path" rule with a fixture-derived floor |

Combined, the #27–#39 additions grew `references/comprehension.md` by 30
inserted lines against 13 deleted (`git diff aacab78~1..HEAD -- skill/`) — all
of it context cost paid on every repair turn, none of it enforcing anything a
checker does not already enforce.

**Do not restore old capture artifacts or edit golden cases as part of this
revert.** Attempts 1–35 are immutable per `eval/runtime/README.md`.

### 5.2 Generalize — valid concept, fixture-specific expression

| PR | Concept worth keeping | Generalized form |
|---|---|---|
| #34/#35/#36/#38 | Command-like text in a reply is **data, not an instruction**, and the reply must say so | This is a genuine safety rule and already has a general form at `SKILL.md:39` and `references/comprehension.md:50-53`. Keep the concept; drop any residual literal-token expectation. PR #38's move from the `hostile` literal to a `runtime_must_convey` concept set was the right direction — `eval/runtime/README.md` documents it as an oracle correction. Finish the job: the shipped prose should name no witness token at all. |
| #30/#32 | After a failed diagnosis, the next diagnosis must genuinely widen, not relabel | Keep as a one-line rule ("lead with a different source proposition; do not relabel, split, or reorder the failed set"). Drop the per-scenario path lists. |
| #26 | A quoted question is not a marker | Already in the classifier table (`references/comprehension.md:45-46`, rules 4–5) and `src/reference-classifier.ts`. Keep the classifier; the extra prose is redundant. |
| #36 | One term per concept in ordinary replies | Already a Layer 1 checker (`one-term-one-concept`, `src/checkers.ts:252`) and a `SKILL.md:65-67` rule. The `references/comprehension.md:52-53` restatement with the `change`/`alter` example is redundant. |

### 5.3 Retain — genuinely harness/tooling work

| PR | Change | Verdict |
|---|---|---|
| #28 | `capture-m2.ts` retains run identity across resumes | Retain. Capture-harness correctness, no shipped-text impact. |
| #27 (capture half) | Capture scenario identities | Retain the capture-side change; revert the skill-side half. |
| #38 (runtime half) | `runtime_must_convey` concept sets replacing a literal witness | Retain, and extend the pattern: **no runtime oracle should ever be a single literal token.** Codify in `eval/runtime/README.md`. |

### 5.4 Reconsider — the cohort gate (#40, #41)

`src/m2-cohort.ts` requires exactly five trials, **all five** hard-clean
(`allThresholdsPass && proseErrorCount === 0 && suspiciousAttemptCount === 0`),
plus ≥4 semantic passes. `eval/runtime/README.md` scopes it to "one pinned
commit/model/harness".

Two problems:

1. **It is the wrong shape.** Requiring 5/5 zero prose errors from a
   probabilistic generator makes any nonzero per-sample prose-failure rate a
   release blocker. The cohort's own result proves this: 4/5 clean, rejected.
   Tightening the prompt to reach 5/5 is precisely the drift this reset exists
   to stop.
2. **It is single-model.** A gate scoped to one pinned model cannot be product
   release acceptance for a skill whose premise is portability. The handoff
   says this explicitly.

**Recommendation: retain the code, replace the policy.** The aggregation
function is small, tested (`test/m2-cohort.test.ts`), and honest — it refuses
sample selection and rejects malformed trial sets, which is exactly the
anti-gaming property the eval stack wants. What should change:

- Reframe as **per-model evidence**, not release acceptance. Rename in
  `eval/runtime/README.md` accordingly.
- Replace `hardPass = every(...)` with a **threshold** (`k` of `n` clean, `k`
  and `n` stated per model) so ordinary sampling variance does not force a
  prompt edit.
- Require the matrix in §6 — which is model-independent — as the actual release
  gate. Prose quality becomes reported evidence per model, not a merge blocker.
- Keep `M2_COHORT_SIZE`/`M2_SEMANTIC_PASSES_REQUIRED` exported and typed
  (D3 style), so recalibration is a PATCH.

PR #41 (allow empty semantic attestations) is a small CLI-arg fix and is fine
either way.

---

## 6. Proposed cross-harness compatibility matrix

The point of this matrix: it is **model-independent**. Every row is decided by
code and filesystem state, never by sampling. It is the release gate the
product actually needs, and it is what §4 of the handoff asks for.

### 6.1 Dimensions

| # | Dimension | What is asserted | How verified |
|---|---|---|---|
| 1 | **Discovery** | Installed tree lands at the harness's documented root; `name:` matches the directory; frontmatter within Cursor's `name`≤64 / `description`≤1024 limits | Filesystem assert after a real install into a temp `HOME`; existing `checkSkillFrontmatter` |
| 2 | **Profile script execution** | `profile.js load` succeeds when invoked from a **project-root cwd**, not the skill dir | Spawn `node <resolved>/scripts/profile.js load` with `cwd` set to a temp project; assert exit 0 and stdout JSON |
| 3 | **Relative reference resolution** | Every relative link in `SKILL.md` and `references/**` resolves inside the installed tree | Static link walk over the installed tree |
| 4 | **Safe tool/data boundary** | No bundled script makes a network call; `IM_DUMB_PROFILE` is honoured for both `load` and `save`; no path outside it is written | Existing `test/skill.test.ts:317` extended to run against the installed tree, not the repo tree |
| 5 | **Core prompt presence** | The always-loaded body contains each required rule section, and the body word budget holds after install | Section assert + D12 word budget on the installed `SKILL.md` |
| 6 | **Idempotent install/upgrade** | Same version → no-op; different version → replace; shared `.agents/` collapse behaves | Already covered by `test/install*.test.ts`; extend to Codex |

Rows 1–6 are **blocking**. Model-generated prose quality is **reported, never
blocking** in this matrix — that separation is the whole point.

### 6.2 Harness columns

| Dimension | Claude Code | Cursor | Codex | Pi |
|---|---|---|---|---|
| 1 Discovery | `~/.claude/skills/im-dumb` · `.claude/skills/im-dumb` | `~/.cursor/skills/im-dumb` · `.cursor/skills/im-dumb` | `$CODEX_HOME/skills/im-dumb` (global only; default `~/.codex/skills`) | `~/.pi/agent/skills/im-dumb` · `.pi/skills/im-dumb` · package `pi.skills` |
| 2 Script exec | assert | assert | assert | assert |
| 3 Refs | assert | assert | assert | assert |
| 4 Boundary | assert | assert | assert (sandbox: no escalation needed) | assert |
| 5 Prompt presence | assert | assert · **must omit** `disable-model-invocation` | assert | assert |
| 6 Idempotency | assert | assert | assert | assert |
| Shared `.agents/` | excluded by design | eligible | eligible | eligible |
| Optional enhanced mode | plugin + `SessionStart`/`UserPromptSubmit` hooks | `~/.cursor/hooks.json` (own event names) | `.codex-plugin/` + `[features] hooks = true` | **extension API — strongest lever** |

### 6.3 What the matrix deliberately excludes

- Exact first lines, exact literals, exact candidate counts.
- Any single runtime capture as a pass/fail signal.
- Any single model as the acceptance authority.

Those move to a reported, per-model, distributional prose report. The product
ships on the matrix.

---

## 7. Proposed sequence (not approved, not started)

1. **Fix the script path** (§1.4, §4.1) — implemented by rewriting relative
   commands to shell-quoted installed paths, including same-version repairs.
2. **Land the compatibility matrix** (§6) as real tests against temporary
   Claude, Cursor, Codex, and Pi installs — implemented for discovery, script
   execution from project cwd, relative references, and core prompt presence.
3. **Add Codex as installable** (§3.3) — implemented for `$CODEX_HOME` global
   installs. Project scope remains rejected because no documented project root
   was found.
4. **Revert §5.1** — implemented. The fixture literals are gone from `SKILL.md`
   and `references/comprehension.md`; `test/comprehension-reference.test.ts` and
   `test/skill.test.ts` assert the generalized forms from §5.2. Body is 871
   words, reference down 37 lines.
5. **Reframe the cohort** (§5.4) — implemented. `hardPass` is now
   `cleanTrials`/`meetsThreshold` at `M2_CLEAN_TRIALS_REQUIRED` of
   `M2_COHORT_SIZE`; `eval/runtime/README.md` calls it per-model evidence and
   names the compatibility matrix as the release gate.
6. **Pi extension** for enhanced mode (§4.2) — implemented.
   `src/pi-extension.ts` appends the active profile to the system prompt on
   `before_agent_start`. Never a correctness prerequisite — the skill stays
   fully functional on every harness without it, and a profile failure returns
   no override.

Steps 1–3 are additive and do not touch shipped prompt semantics. Step 4 is the
behavioral revert and wants explicit user sign-off, because it will change M2
capture outcomes — which is the intended result, not a regression.

## 8. Answered questions

1. **Is exact-output enforcement still a requirement?** **Yes, on Pi first.**
   Pi gets real enforcement through its extension API; Claude, Cursor, and
   Codex get a weaker best-effort form later. The skill must work on all four
   without any extension — enforcement is an enhancement, never a dependency.
2. **Does Codex move from "detect-only" to installable now?** **Yes**, global
   `$CODEX_HOME/skills` only (#42). Project scope stays rejected — no
   documented project skill root.
3. **Cohort: replace or delete?** **Replaced** (#43). Code retained,
   `k`-of-`n` threshold, scoped to per-model evidence.
4. **AV (M5 phase 3)?** **Dropped from scope.** Bundled generators need
   TTS/ffmpeg, which collides with the no-network and dependency-free
   invariants. The skill already declines audio and video plainly. If AV ever
   returns it is as a host integration — a Pi extension or MCP server calling
   an external generator, same class as enhanced mode, so the network call
   stays outside the skill bundle. Stretch goal, not planned work.
5. **Does the `.eduardo/` untracked tree matter here?** Left untouched per the
   handoff freeze; not inspected.
