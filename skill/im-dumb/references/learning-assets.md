# Learning assets (Markdown / HTML)

Read this only when the user asks for a durable explainer: notes, cheatsheet,
study guide, handout, "write this up", or "save this as markdown/html".
Do not read it for ordinary answers.

Generate the asset in one pass, inside a fenced block, using the active
profile. Never rewrite it in a second pass and never call another model.

The profile field `learning_asset_preferences.formats` lists the formats the
user accepts (default: `markdown` and `html`). When the user does not name a
format, use the first listed. When they ask for a format that is not listed,
say so in one line and offer a listed one. An empty list means assets are
turned off: say so plainly and answer in chat instead.

## Same rules as chat

The asset obeys every language rule already in force: sentence cap, jargon
policy with define-on-first-use, forbidden phrases, one term per concept, and
ADHD chunking when it is on. A longer format is not permission for longer
sentences.

## Markdown shape

1. `#` H1 title naming the thing being explained.
2. One short overview paragraph — what it is and why the reader cares.
3. A numbered list for a process, or a bulleted list for parts. At least one
   list is required.
4. Optional `## Glossary` with each defined term on its own line, only for
   terms the asset itself introduced.
5. Last line: `Profile applied: <short phrase>` naming what shaped the text
   (for example short sentences, no unexplained jargon). One line, no dump of
   profile values.

## HTML shape

- One `<article>` wrapper.
- One `<h1>` title.
- One `<section>` per markdown section, same order.
- Self-contained: no `<script src=...>` and no external stylesheet link.
  Inline `<style>` is allowed and optional.
- Same closing `Profile applied:` line, inside the final `<section>`.

## Slides

When the user asks for slides, emit HTML: one `<article>` deck, one `<h1>`
deck title, and one `<section class="slide">` per point. Every slide carries
its own `<h2>` heading and one idea. A deck needs at least two slides. The
last slide holds the `Profile applied:` line. Same self-containment rule as
HTML: no external script or stylesheet. No binary PowerPoint output.

## Audio and video

Not supported. Say so plainly and offer the markdown or HTML asset instead.
