## Overview im-dumb is a 
cross-harness AI skill/plugin that 
shapes LLM responses at generation time to match 
how an individual user actually 
understands language — using their 
preferred vocabulary, avoiding 
patterns that confuse them, and 
adapting structure for 
ADHD-friendly consumption when 
needed. The skill is configured 
once through an onboarding flow 
that produces a portable, global 
user profile, then applies that 
profile automatically across 
future interactions in Claude, 
Cursor, Codex, and Pi. The core 
motivation: LLMs default to 
fluffy, jargon-dense, 
assumption-heavy explanations that 
make learning harder rather than 
easier. im-dumb intercepts that 
pattern at generation time rather 
than asking users to keep 
re-prompting for simpler language. 
## 1. Problem Statement Most LLM 
responses assume a baseline of 
shared vocabulary, domain fluency, 
and working-memory capacity that 
many users do not have. When a 
response fails to land, the 
typical failure mode is a vague "I 
don't understand," which is itself 
hard to act on — the user often 
cannot articulate *which* part 
failed, and the model has no 
structured way to diagnose it. 
This creates a repeating cycle of 
restated, still-unclear answers. 
Additionally, no persistent 
mechanism exists across sessions 
or across different AI coding/chat 
harnesses to remember how a 
specific person prefers to be 
spoken to. ## 2. Goals - Let any 
user define, once, how they want 
AI to communicate with them — 
vocabulary level, sentence 
complexity, jargon tolerance, 
tone, structure. - Persist that 
definition as a portable global 
config usable across supported 
harnesses. - Detect and repair 
responses that are likely to 
confuse the user, using an 
intelligent comprehension gate 
rather than a generic 
clarification request. - Support 
an explicit ADHD mode that changes 
structure (chunking, answer-first 
ordering) rather than just 
shortening text. - Be 
token-efficient: minimize overhead 
added by the skill relative to an 
unmodified response. - Support 
onboarding, profile evolution, and 
— post-launch — generation of 
learning-aid media assets 
(Markdown, HTML, slides, 
eventually audio/video). - Ship as 
an installable package (`npx 
im-dumb`) targeting Claude, 
Cursor, Codex, and Pi, with global 
and project-level install scopes. 
## 3. Non-Goals (v1) - Clinical 
ADHD diagnosis or treatment claims 
— "ADHD mode" is a communication 
accommodation, not a medical 
feature. - Full multimedia 
generation (video, voice) — 
deferred to a later milestone 
behind the Markdown/HTML/slides 
foundation. - Automated hosted-API 
skill publishing (Claude API 
`/v1/skills`, OpenAI hosted 
skills) — deferred to a manual or 
v2 CLI path. ## 4. Research 
Foundation im-dumb's rule design 
is not ad hoc — it is built on top 
of an existing controlled-language 
standard plus a body of cognitive 
science and communication 
research. ### 4.1 ASD-STE100 
Simplified Technical English 
ASD-STE100 is a controlled natural 
language standard built for 
aerospace and defense technical 
writing, designed to reduce 
ambiguity for readers who are not 
necessarily native English 
speakers. Its core rules — 
approved-word vocabulary, one word 
per concept, short instructional 
sentences (roughly 20 words or 
fewer), active voice, and 
single-topic short paragraphs — 
are adopted as a *style constraint 
layer*, not a full compliance 
requirement, since STE's formal 
approved-word dictionary is built 
for manuals, not open 
conversation.[1] ### 4.2 Cognitive 
Load Theory and Mayer's Multimedia 
Learning Principles Cognitive Load 
Theory frames working memory as a 
limited resource that 
instructional material can 
needlessly overload through poor 
structuring, irrelevant detail, or 
ambiguous signaling. Mayer's 
multimedia learning principles — 
coherence (exclude irrelevant 
material), signaling (highlight 
essential structure), and 
segmenting (break content into 
learner-paced chunks) — map 
directly onto im-dumb's rule
layer: strip filler, mark 
structure explicitly, and chunk 
complex explanations rather than 
deliver them as one dense block. 
### 4.3 Plain Language and 
Readability Research 
Plain-language research 
establishes that shorter 
sentences, familiar words, and 
active voice measurably improve 
comprehension for general 
audiences. However, an important 
caveat from empirical readability 
research is directly incorporated 
into im-dumb's design: standard 
readability formulas (e.g., 
Flesch-Kincaid) can be gamed by 
superficial edits (shorter words, 
more periods) without any real 
gain in comprehension, so such 
scores are used only as a 
supporting signal, never as a 
standalone measure of success. ### 
4.4 ADHD and Working-Memory 
Research Research on working 
memory and chunking supports 
presenting no more than a small 
number of discrete items at once, 
favoring answer-first ordering, 
and using explicit segment breaks 
so users do not have to hold an 
entire unstructured response in 
working memory to extract the 
point. This is the basis for "ADHD 
mode" as a structural 
transformation (chunk to 2-3 
items, lead with the direct 
answer, mark segment boundaries) 
rather than merely a 
shorter-response mode. ### 4.5 The 
Feynman Technique The Feynman 
technique's core discipline — 
explain a concept in the simplest 
possible terms, and if you can't, 
you don't understand it well 
enough — informs im-dumb's 
"plain-English + technical 
version" dual-output pattern for 
complex topics, ensuring 
simplification doesn't silently 
drop technically important 
information. ### 4.6 Prior Art: 
caveman and ELI5 - **caveman**: a 
skill focused on aggressive 
token/response compression 
("shrink the mouth, not the 
brain") with transparent reporting 
of token savings. im-dumb borrows 
the compression discipline and the 
practice of surfacing honest 
token-overhead numbers, applying 
them to its own cost-efficiency 
gate (Section 9). - **ELI5**: a 
simplification-style skill focused 
on explaining concepts at a basic 
comprehension level. im-dumb 
borrows the "explain simply" 
default behavior but extends it 
with a *personalized*, persistent 
profile rather than a fixed 
simplification level applied 
uniformly to every user. ### 4.7 
Clarification and Dialogue 
Research A study of real 
consumer-service dialogues found 
that generic clarification 
requests are the least satisfying 
strategy for resolving 
misunderstanding — offering 
specific candidate interpretations 
alongside the question measurably 
outperforms a bare "I don't 
understand". Research on LLM 
clarification behavior (the CLAM 
framework) additionally shows 
models often over-trigger 
clarification on surface-level 
ambiguity while under-triggering 
on genuine task confusion — the 
opposite of what's useful — 
motivating a two-stage detection 
approach rather than a single 
clarification heuristic. ### 4.8 
Scaffolding and the Zone of 
Proximal Development Vygotsky's 
zone-of-proximal-development 
research frames effective 
scaffolding as support that 
narrows as competence grows and is 
explicitly withdrawn once no 
longer needed. This directly 
informs im-dumb's profile-driven 
tapering: once the system has 
learned a user's specific 
comprehension gaps, it should stop 
re-asking and just apply the fix. 
## 5. Core Feature: Personalized 
Communication Profile ### 5.1 
Onboarding Flow A short, guided 
onboarding session asks the user 
about preferred vocabulary level, 
tolerance for jargon 
(with-definition vs. 
avoid-entirely), sentence-length 
comfort, tone preferences, 
preferred output shape 
(answer-first vs. narrative), and 
whether ADHD mode should default 
on. Onboarding output is a 
structured config, not free-form 
notes, so it can be 
applied by the model at generation time. ### 5.2 Global Config 
Schema (illustrative) ```yaml 
profile:
  vocabulary_level: common # common | technical-ok | 
expert
  jargon_policy: define-on-first-use 
  sentence_length_cap: 20 paragraph_topic_limit: 1 
  tone: direct output_shape: answer-first adhd_mode: 
  false known_gap_types: [] # populated over time by 
  the comprehension gate forbidden_phrases: [] 
  learning_asset_preferences:
    formats: [markdown, html] ``` ### 5.3 Language 
Rules (Applied at Generation Time) - Use common words 
first; define technical terms once, in-line, only 
when necessary. - One term per concept — never switch 
terminology mid-answer for the same idea. - Active 
voice by default. - Prose sentences capped near 20 words (broadened from STE's instructional-sentence guidance).[1] - One 
topic per paragraph. - No hype, filler, marketing 
tone, or unnecessary hedging/disclaimers. - No 
unexplained acronyms or stacked qualifiers in one 
sentence. ### 5.4 ADHD Mode When enabled, responses 
are restructured — not merely shortened — using 
working-memory chunking research: answers lead with 
the direct conclusion, supporting detail is grouped 
into small chunks (2-3 items), and segment boundaries 
are made explicit so the response can be scanned 
rather than read start-to-finish to extract meaning. 
### 5.5 Output Shape Default response shape: direct 
answer → why it works → steps → example. This 
mirrors the Feynman-technique discipline of pairing a 
plain-English version with a technical version when a 
topic is genuinely complex, so simplification never 
silently discards a technically important detail. ## 
6. Core Feature: Comprehension Gate ### 6.1 Problem 
This Solves A vague user reply like "I don't 
understand" gives the system almost no signal about 
*which* part of a response failed — a specific term, 
a specific step, or the entire framing — and many 
users cannot self-diagnose well enough to ask a more 
useful follow-up question. ### 6.2 Detection 
(Two-Stage, to Avoid Over-Triggering) 1. **Lexical 
pre-filter**: cheap, deterministic check for 
vague-confusion markers in the user's reply (e.g., "I 
don't get it," "huh?," "what?") without any model 
call. 2. **Selective-clarification confirmation**: a 
lightweight check that confirms genuine 
non-understanding before committing to a full 
diagnostic response, directly addressing the 
documented tendency of LLMs to over-trigger on 
surface ambiguity and under-trigger on real 
confusion. ### 6.3 Guided Diagnosis, Not a Bare 
Question When the gate fires, it decomposes its own 
prior response into 2-4 concrete named candidates for 
what likely caused confusion (a specific term, a 
specific step, the overall approach) and asks the 
user to pick or confirm — never a bare, un-scoped 
"what didn't you understand?" — because naming 
candidate interpretations is measurably more 
effective than generic clarification requests. ### 
6.4 Profile-Driven Tapering Each resolved confusion 
updates `known_gap_types` in the user's profile. As 
confidence in a recurring gap type grows, the gate 
skips the diagnostic step for that gap type and 
applies the known fix directly — support narrows and 
is withdrawn as competence in that area is 
established, consistent with 
zone-of-proximal-development scaffolding research. 
### 6.5 Second-Failure Escalation An explicit "I 
still don't understand" after a corrected response is 
treated as strong, near-explicit evidence that the 
last assumption about the user's gap was wrong. This 
always triggers full re-diagnosis — even overriding a 
prior confidence-based skip — and widens the 
candidate search beyond the first guess. ### 6.6 Hard 
Constraints - At most one clarifying question per 
turn. - Never a bare, unscoped "I don't understand" 
prompt back to the user. ## 7. Learning Asset 
Generation (Post-Base Milestone) Once the base 
profile and gate are working, im-dumb adds a 
mechanism to generate learning aids matched to the 
user's profile and the topic's complexity, following 
a phased rollout: 1. **Phase 1**: Markdown and HTML 
explainer documents. 2. **Phase 2**: Slide decks 
(PowerPoint/HTML slides) for step-by-step or 
comparative topics. 3. **Phase 3**: Audio and video 
generation for topics that benefit from dual-coding 
(verbal + visual) presentation, consistent with 
multimedia learning research on combining channels 
rather than relying on text alone. Asset generation 
respects the same profile constraints (vocabulary, 
sentence length, chunking) used in chat responses, so 
a generated explainer document is not simplified in 
chat but jargon-dense in the exported asset. ## 8. 
Token Efficiency im-dumb explicitly treats token 
overhead as a constraint, not an afterthought, taking 
direct inspiration from caveman's practice of 
reporting honest token-savings numbers rather than 
assuming compression is free or automatically 
neutral. Every profile-driven transformation is 
measured against an unmodified baseline response to 
the same prompt, and a token-overhead ceiling is 
enforced as part of the evaluation gates below. ## 9. 
Evaluation Strategy (Planned Before Implementation) 
Evals are designed *before* the skill is built, 
following eval-driven-development practice, so "pass" 
has a fixed, pre-agreed meaning rather than being 
redefined after the fact to match whatever the skill 
happens to output. ### 9.1 Why Naive Single-Run Evals 
Fail Here im-dumb's output is nondeterministic, 
partly subjective (readability, "did this feel 
clearer"), and stateful (the profile and 
comprehension gate only make sense evaluated across 
multi-turn sequences). A case that passes 3 of 5 runs 
reveals something a single green run would hide, so 
the eval design accounts for variance directly rather 
than discovering it in production. ### 9.2 Five-Stage 
Gate Pipeline | Gate | What it checks | Cost | Blocks 
merge? | |---|---|---|---| | 1. Lint / deterministic 
| Schema validity, forbidden-word violations, 
sentence-length caps, output structure | Free, 
instant | Yes, always | | 2. Offline eval (PR smoke 
suite) | Curated golden set — constraint compliance + 
judge scoring | Cents, minutes | Yes, on regression | 
| 3. Cost/token budget | Token overhead vs. baseline 
| Free (computed) | Yes, if over ceiling | | 4. 
Nightly full suite | Full rubric sweep, multi-turn 
comprehension-gate sequences | Dollars, ~45 min | No 
— flags for review | | 5. Shadow eval / canary | Real 
anonymized traces run through candidate vs. 
production skill, gradual rollout | Ongoing | 
Auto-rollback on breach | Expensive gates never block 
every PR — an expensive suite gating every push is 
the most common reason teams quietly bypass their own 
eval suite. ### 9.3 Deterministic Layer (Run First, 
Always) Sentence-length caps, forbidden-term matches, 
one-term-one-concept lexical checks, output-shape 
validation, comprehension-gate structural checks 
(single question per turn, named candidates present), 
and profile-schema JSON/YAML validity — all checkable 
by code, at zero variance, before any LLM judge is 
invoked. ### 9.4 Golden Dataset 25-50 curated (not 
randomly sampled) cases initially, covering: baseline 
explanations across three knowledge-level personas; 
jargon-heavy source material requiring lossless 
decomposition; ADHD-mode on/off pairs on identical 
input; comprehension-gate trigger cases including 
false positives; profile-adaptation multi-turn 
sequences; adversarial cases designed to induce 
jargon leakage or unsafe over-simplification. 
Datasets and rubrics are versioned in-repo under 
review, since editing a failing test case is the 
quiet way a gate gets weakened. ### 9.5 
Nondeterminism-Aware Scoring 3-5 trials per case; 
thresholds set relative to a trailing baseline with a 
tolerance band (not an absolute cutoff) and validated 
with a significance test (Welch's t-test for 
continuous scores, two-proportion z-test for binary 
pass/fail); judge model pinned by version at 
temperature 0, since a silent judge upgrade would 
otherwise be indistinguishable from an actual skill 
regression; flaky cases quarantined out of the 
blocking set rather than left to erode trust in the 
whole gate. ### 9.6 LLM-as-Judge, Designed Against 
Known Failure Modes A rigorous psychometric study of 
LLM-judged benchmarks found judges frequently do not 
faithfully follow their stated rubric — unexplained 
variance in overall verdicts ranged from roughly 26% 
to as high as 87-90% depending on the judge model — 
and that rubric dimensions meant to be independent 
(correctness, completeness, style) often collapse 
into a single latent factor, with ELO/Bradley-Terry 
aggregation producing falsely smooth-looking rankings 
that mask this underlying incoherence. Consequences 
for im-dumb's rubric design: - Keep rubric dimensions 
genuinely separable (e.g., factual fidelity, 
constraint compliance, "would this reader need a 
follow-up question") rather than near-synonymous 
labels. - Never use ELO/ranking-style aggregation — 
im-dumb evaluation is pass/fail-against-a-rubric, not 
comparative preference ranking. - Report raw 
per-dimension scores, not a single collapsed number. 
- Use a separate judge model from the production 
model to avoid self-preference bias. - Periodically 
audit whether judge verdicts are actually explained 
by the stated rubric. ### 9.7 
Comprehension-Gate-Specific Evals Precision/recall on 
gate triggering (correctly firing on genuine 
confusion, not firing on surface-level 
vague-but-clear replies); a scaffolding-taper 
regression test asserting clarifying-question rate 
trends toward zero as `known_gap_types` confidence 
rises; a second-failure escalation test asserting 
full re-diagnosis on repeated "I still don't 
understand"; and the single-question-per-turn 
structural invariant from Section 9.3. ### 9.8 Human 
and Behavioral Evals - **Comprehension quiz A/B**: 
real users read baseline vs. im-dumb-modified 
explanations of matched-difficulty material, then 
answer comprehension questions; success measured by 
quiz-accuracy delta, not judge score. - 
**Readability-gaming check**: any 
Flesch-Kincaid-style score is a supporting signal 
only, cross-checked against the comprehension quiz, 
since such formulas are documented to be gameable 
without real comprehension gains. ### 9.9 Trigger and 
Blocking Policy Evals run only on diffs touching 
prompts, skill rules, the profile schema, or eval 
configs — not unrelated changes. (Path filtering activates when expensive gates exist, M3 onward; per-milestone reading recorded in AGENTS.md.) Layer 1 and the 
curated Layer 2 smoke suite hard-block merges; 
broader judge-scored suites warn and route to human 
review rather than hard-blocking, to avoid 
flaky-judge-driven merge blocks. A single audited 
override path (required label + second approver) 
exists for genuine urgent exceptions. Every result 
artifact records skill version, judge model version, 
dataset hash, and trial count for traceability. ### 
9.10 Pre-Code Checklist - [ ] Golden dataset (25-50 
cases) drafted and versioned, covering all required 
case categories - [ ] Deterministic constraint 
checkers implemented independently of any LLM call - 
[ ] Judge rubric drafted with non-redundant 
dimensions; ELO aggregation explicitly excluded - [ ] 
Baseline (pre-skill) response set captured for 
token-overhead and comprehension-quiz comparison - [ 
] Comprehension-gate precision/recall, taper, and 
escalation test scaffolds written - [ ] CI wiring: 
path-filtered triggers, tiered blocking policy, 
override mechanism, spend alerting - [ ] Human 
comprehension-quiz protocol finalized - [ ] Judge 
model/version pinned; re-baselining process 
documented ## 10. Target Harnesses and Distribution 
im-dumb targets four harnesses at launch: Claude 
(Claude Code / Claude API / claude.ai), Cursor, 
OpenAI Codex/Responses API, and Pi. All four 
implement or converge on the same open convention: a 
directory containing `SKILL.md` with YAML frontmatter 
(`name`, `description`) plus an instruction body, 
optionally bundled with scripts and references, 
loaded into context only when triggered (progressive 
disclosure). OpenAI's documentation states its Skills 
implementation is "compatible with the open Agent 
Skills standard," and Pi's documentation states it 
"implements the Agent Skills standard" — this shared 
foundation is what makes a single package targetable 
at all four rather than requiring four forks.[2][1] 
### 10.1 Per-Harness Install Paths and Constraints | 
Harness | Global (user) path | Project path | 
Discovery | Runtime notes | |---|---|---|---|---| | 
Claude Code | `~/.claude/skills/` | `.claude/skills/` 
| Filesystem scan; Claude reads `SKILL.md` via bash 
when triggered[1] | Full network access; personal or 
shared via Claude Code Plugins[1] | | Claude API / 
claude.ai | N/A (workspace/user upload) | N/A | 
Uploaded via `/v1/skills` or zip in claude.ai 
settings; referenced by `skill_id`[1] | No network 
access, no runtime package installs[1] | | Cursor | 
`~/.cursor/skills/` | `.cursor/skills/` (also 
`.agents/skills/`) | Auto-discovery by description 
match, or manual `/skill-name` invocation; nightly 
channel | Frontmatter `name` must match folder name 
exactly — stricter than Pi[3][4] | | OpenAI 
(Codex/Responses API) | N/A (hosted, versioned 
server-side) | Local shell: path-based config object 
| Hosted: `skill_reference` by `skill_id`+version; 
local shell: `{name, description, path}`[1] | Hosted 
skills run in an ephemeral container; local shell 
mode stays on developer-controlled infra[1] | | Pi | 
`~/.pi/agent/skills/`, `~/.agents/skills/` | 
`.pi/skills/`, `.agents/skills/` (after project 
trust) | Startup scan extracts name/description; 
forced via `/skill:name`[1] | Can load other 
harnesses' skill directories directly (e.g., 
`~/.claude/skills`) — the clearest built-in 
cross-harness bridge[1] | Two structural facts drive 
the installer design: 1. Shared directories are the 
real interoperability point. Pi's docs note that 
requiring `name` to match its parent directory "is 
suboptimal for shared skill directories used across 
multiple agent harnesses" and deliberately relaxes 
this, while Cursor enforces the strict match. 
Community guidance converges on a single 
`.agents/skills/` directory as the shared source of 
truth. im-dumb's directory name and frontmatter 
`name` are therefore kept in sync everywhere to 
satisfy the strictest (Cursor) requirement.[3][5][1] 
2. Hosted surfaces (Claude API, OpenAI Responses API) 
require credentialed upload, not a directory drop — 
so the v1 installer targets only the three 
filesystem-based surfaces directly, deferring hosted 
publishing to a documented manual step or a v2 CLI 
subcommand.[2][1] ### 10.2 Security Posture Anthropic 
and OpenAI's official docs both flag the same risk 
categories for third-party skills: prompt injection 
via malicious `SKILL.md` content, unvetted 
tool/command invocation, and data exfiltration, with 
OpenAI's guidance further recommending gating 
high-impact actions behind explicit approval. Pi's 
docs carry an identical inline warning. 
Consequently:[1][2] - The npx installer only writes 
local files the user can review before first run — no 
remote fetch-and-execute step, consistent with 
Cursor's own guidance that skills work only as local 
files with no built-in remote URL loading.[6] - 
im-dumb ships no scripts that make outbound network 
calls at invocation time, since the most locked-down 
modes of Claude API and OpenAI hosted Skills 
explicitly disallow network access.[2][1] ### 10.3 
Skill Package Design for Cross-Harness Compatibility 
- `name: im-dumb` — lowercase, hyphenated, matches 
its directory exactly. - `description` kept under the 
shared 1024-character ceiling, stating both what the 
skill does and when to trigger it, per Pi's 
documented "good vs. poor description" guidance.[1] - 
Auto-discovery is the default trigger path across 
Claude Code, Cursor, and Pi, with an explicit 
`/skill:im-dumb` or `/im-dumb` fallback documented in 
`SKILL.md`, since models don't always self-trigger a 
skill read reliably.[1] - Bundled scripts are 
TypeScript compiled to dependency-free JS (see 
Section 11), so the same script runs unmodified 
across Claude Code, Cursor, and Pi's Node-based 
runtimes without hitting the "pre-installed packages 
only" trap documented for Claude API/OpenAI hosted 
modes.[2][1] ### 10.4 The `im-dumb` Installer (npx) - 
Distributed via npm, runnable as `npx im-dumb` with 
no global install required. - **Auto-detection**: 
scans home directory and working directory/ancestors 
up to the git root (mirroring Pi's own project-trust 
boundary) for `~/.claude/`/`.claude/`, 
`~/.cursor/`/`.cursor/`, 
`~/.pi/agent/`/`~/.agents/`/`.pi/`/`.agents/`, and 
Codex/OpenAI CLI markers.[1] - **Interactive 
selection**: presents detected harnesses as a 
multi-select checklist with an explicit **Global vs. 
Project** scope toggle per harness — supported 
natively by every filesystem-based target.[1] - 
**Non-interactive/CI mode**: `npx im-dumb install 
--targets claude,cursor,pi --scope global`. - 
**Idempotency**: detects existing installs, diffs 
version, prompts to upgrade rather than duplicating 
files. - **Shared-directory awareness**: writes once 
to `.agents/skills/im-dumb/` when that convention is 
already in use, skipping duplicate per-harness 
copies.[5] - Hosted uploads (Claude API, OpenAI) are 
explicitly out of scope for v1, deferred to a manual 
step or `im-dumb publish --target openai-api` in a 
later milestone. ## 11. Engineering and Release 
Governance ### 11.1 Language Standard All scripts and 
the installer are written in TypeScript, compiled to 
plain JavaScript, avoiding any dependency on a Python 
runtime and aligning with the Node-based runtimes 
already used by Cursor and Pi, while sidestepping the 
"no runtime package installation" constraint 
documented for Claude API and OpenAI hosted 
Skills.[2][1] ### 11.2 Strict Semantic Versioning - 
Package and skill `metadata.version` both follow 
strict SemVer (`MAJOR.MINOR.PATCH`). - **MAJOR**: 
breaking change to profile schema, comprehension-gate 
contract, or removal of a supported harness. - 
**MINOR**: new backward-compatible capability (new 
media generator, new harness target). - **PATCH**: 
bug fixes, rule tuning, eval threshold recalibration 
with no contract change. - This mirrors OpenAI's own 
hosted-skill versioning model (`default_version`, 
`latest_version`, explicit version references), so 
im-dumb's internal versioning maps cleanly onto that 
path when hosted publishing is added.[1] ### 11.3 
Pull Request Policy - Every PR title must be a valid 
Conventional Commit header (`feat:`, `fix:`, `docs:`, 
`chore:`, `refactor:`, `test:`, `feat!:`/`BREAKING 
CHANGE:` for majors), enforced by a required, 
blocking CI title-lint check. - CI must be green 
before merge, with the same single audited override 
path (required label + second approver) defined for 
the eval gates in Section 9.9 — one documented bypass 
process across the whole pipeline, not two. - 
Required PR-time checks: title lint, TypeScript 
build/typecheck, Layer 1 deterministic checks, 
curated Layer 2 offline eval smoke suite. ### 11.4 
Manual Release Trigger Version bumps and publishing 
are not automatic on merge. A maintainer manually 
triggers a `workflow_dispatch` GitHub Action that: 
computes the next SemVer version from Conventional 
Commit history since the last tag; runs the full 
nightly eval suite (all five gates, §9.2) as a release-blocking 
gate distinct from lighter PR-time checks; builds and 
publishes the npm package; tags the release and 
generates a changelog; optionally cuts a skill-bundle 
zip for manual Claude API/OpenAI hosted upload. This 
ensures no version number is ever assigned to code 
that has not passed the full, expensive eval sweep. 
### 11.5 Governance Checklist - [ ] Skill directory 
name and frontmatter `name` kept in sync across all 
install targets - [ ] No outbound network calls from 
bundled scripts at invocation time - [ ] All 
scripts/installer in TypeScript, compiled to 
dependency-free JS - [ ] npx installer with harness 
auto-detection, multi-select, global/project scope 
toggle - [ ] Shared `.agents/skills/` write-once path 
supported where applicable - [ ] PR title 
semantic-lint check wired into CI as required and 
blocking - [ ] CI-green-before-merge enforced with 
the single shared override path - [ ] Manual 
`workflow_dispatch` release workflow gating on the 
full nightly eval suite before publish ## 12. 
Milestones 1. **M1 — Core profile + language rules**: 
onboarding flow, global config schema, STE-inspired 
rule layer, token-efficiency baseline. 2. **M2 — 
Comprehension gate**: two-stage detection, 
candidate-based diagnosis, profile-driven tapering, 
second-failure escalation. 3. **M3 — Eval 
infrastructure**: golden dataset, deterministic 
checkers, judge rubric, CI gate tiers — built before 
M4/M5 ship. 4. **M4 — Multi-harness packaging**: 
`SKILL.md` package, npx installer with auto-detection 
and scope selection, Claude/Cursor/Pi support. 5. 
**M5 — Learning asset generation**: Markdown/HTML 
first, slides next, audio/video as a later extension.
6. **M6 — Governance hardening**: SemVer enforcement, PR title linting, manual release workflow, hosted-upload path for Claude API/OpenAI.
