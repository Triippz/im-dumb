# m5 implementation plan — learning asset generation

Revision 1 — post-M4 merge (`c0196ae`).

## 1. Overview

**Problem**: Chat answers can apply the profile, but users cannot yet ask im-dumb for a durable explainer (Markdown/HTML) that uses the **same** vocabulary/chunking rules. Slides and AV come later.

**Approach**: Prompt-driven generation (ADR-001 — one-shot, no rewrite loop). Add a skill reference that defines asset shapes and when to emit them. Add a small deterministic Layer 1 checker for structural markers. No new runtime deps; no media APIs in Phase 1.

**In scope (M5 Phase 1)**:
- Public plan (this file)
- `skill/im-dumb/references/learning-assets.md` — Markdown + HTML explainer contracts
- SKILL.md trigger + load rules for learning-asset requests
- Deterministic structure checks (title, sections, profile-respect note)
- Golden cases for “export explainer” turns
- Docs sync (README/AGENTS/roadmap)

**In scope later in M5 (separate PR OK)**:
- Phase 2: HTML slide decks (section-per-slide); no PowerPoint binary dependency in v1
- Phase 3 stub only: document AV as future; no generators

**Out of scope (M5)**:
- npm publish / hosted upload (M6)
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

The SKILL.md body target moved 900 → 930 words (`SKILL_BODY_WORD_TARGET`) to
fit the asset trigger. The checker's warn threshold is unchanged at 1000, so
D12 still holds: over-budget is a warning, never a hard error. Every pinned
phrase assertion in `test/skill.test.ts` stayed intact — the budget moved,
no fixture was weakened.

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
| D2 | Phase 2 slides = HTML `<section class="slide">` only; PPTX deferred unless a zero-dep need appears. |
| D3 | Checker stays structural; semantic quality stays Layer 2 judge later. |
| D4 | No new npm dependencies. |
| D5 | Assets honor `learning_asset_preferences.formats` (already in the M1 profile schema); an empty list turns assets off. |
| D6 | `learning-asset` is golden category 7, prompt-shaped — an asset request is one turn, so it reuses the v1 prompt shape. |

## 5. Traceability

| prd §7 | Delivery |
|---|---|
| Phase 1 Markdown/HTML | reference + skill + checker + goldens |
| Phase 2 slides | follow-up PR in M5 |
| Phase 3 AV | stub in docs only |
| Same profile constraints | skill rules + existing Layer 1 language checkers on prose |
