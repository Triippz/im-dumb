# m5 implementation plan, learning asset generation

Revision 1, written after the M4 merge (`c0196ae`).

## 1. Overview

**Problem**: Chat answers can apply the profile, but users cannot yet ask im-dumb for a durable explainer (Markdown/HTML) that uses the **same** vocabulary/chunking rules. Slides and AV come later.

**Approach**: Prompt-driven generation (ADR-001, one-shot, no rewrite loop). Add a skill reference that defines asset shapes and when to emit them. Add a small deterministic Layer 1 checker for structural markers. No new runtime deps; no media APIs in Phase 1.

**In scope (M5 Phase 1)**:
- Public plan (this file)
- `skill/im-dumb/references/learning-assets.md`, Markdown + HTML explainer contracts
- SKILL.md trigger + load rules for learning-asset requests
- Deterministic structure checks (title, sections, profile-respect note)
- Golden cases for “export explainer” turns
- Docs sync (README/AGENTS/roadmap)

**In scope later in M5 (separate PR OK)**:
- Phase 2: HTML slide decks (section-per-slide); no PowerPoint binary dependency in v1

**Out of scope (M5)**:
- npm publish / hosted upload
- Phase 3 AV, **dropped from scope**. Bundled generation needs TTS/ffmpeg,
  which collides with the no-network and dependency-free invariants. The skill
  declines audio and video and offers markdown or HTML instead. A host
  integration (Pi extension or MCP server calling an external generator such as
  Higgsfield) is the only shape that keeps the invariants, since the network
  call lives outside the skill bundle. Stretch goal, not planned work.
- Video/voice model calls
- Post-generation rewrite or second model call
- Changing profile schema

## 2. Requirements

### Functional

1. When the user asks for an explainer, notes, cheatsheet, or “save this as markdown/html”, load `references/learning-assets.md` and produce the asset in-chat (fenced file body) using the active profile.
2. Markdown asset minimum shape: H1 title; short overview; numbered or bulleted steps; optional glossary for defined terms; ends with a one-line “Profile applied” note (not jargon dump).
3. HTML asset minimum shape: `<article>` with `<h1>`, `<section>` blocks matching markdown sections; no external scripts/styles required.
4. Same hard language rules as chat (sentence caps, define-on-first-use, ADHD chunking when on).
5. Layer 1 checker validates structure on fixtures; does not call a model.

### Acceptance criteria

- [x] Plan lands before skill behavior changes.
- [x] Reference + SKILL.md wired; description still &lt; 1024 chars and name-sync intact.
- [x] Checker + tests for markdown/html structure (pass/fail fixtures).
- [x] ≥2 golden cases covering markdown + html request turns.
- [x] README/AGENTS note M5 Phase 1; slides/AV still later.
- [x] `npm test` / typecheck green.

### Budget note

The SKILL.md body target briefly moved 900 → 930 words (`SKILL_BODY_WORD_TARGET`) to
fit the asset trigger, then went back to 900 once the comprehension
non-trigger examples and no-snapshot fallback moved into
`references/comprehension.md`. The checker's warn threshold is unchanged at
1000, so D12 still holds: over-budget is a warning, never a hard error. Every
pinned phrase assertion survived, the moved ones now assert against the
reference file, so no fixture was weakened.

Standing rule: when the body runs out of room, move prose into `references/`.
Only rules needed on every turn belong in the always-loaded body.

## 3. Layout

```
docs/plans/m5-learning-assets.md
skill/im-dumb/references/learning-assets.md
skill/im-dumb/SKILL.md          # trigger + load rule
src/learning-asset-checker.ts   # optional thin wrapper or fold into checkers.ts
eval/golden/cases/learning-asset-*.json
```

## 4. Decisions

| ID | Decision |
|---|---|
| D1 | Assets are generated in the model response (fenced), not written by a bundled network script. |
| D2 | Phase 2 slides = HTML `<section class="slide">` only; PPTX deferred unless a zero-dep need appears. **Shipped**: `MIN_DECK_SLIDES = 2`, per-slide heading required, same self-containment rule as HTML. |
| D3 | Checker stays structural; semantic quality stays Layer 2 judge later. |
| D4 | No new npm dependencies. |
| D5 | Assets honor `learning_asset_preferences.formats` (already in the M1 profile schema); an empty list turns assets off. |
| D6 | `learning-asset` is golden category 7, prompt-shaped, an asset request is one turn, so it reuses the v1 prompt shape. |

## 5. Traceability

| prd §7 | Delivery |
|---|---|
| Phase 1 Markdown/HTML | reference + skill + checker + goldens |
| Phase 2 slides | follow-up PR in M5 |
| Phase 3 AV | dropped from scope; host integration is a stretch goal |
| Same profile constraints | skill rules + existing Layer 1 language checkers on prose |
