# Human comprehension-quiz protocol (M3)

Success is measured by **quiz-accuracy delta** (im-dumb vs baseline), not by
LLM-judge score. Readability formulas are supporting signals only.

## Materials

1. Pick 5–10 matched-difficulty topics (same source facts as a golden case or
   a short excerpt ≤400 words).
2. For each topic prepare:
   - **baseline** explanation (skill off)
   - **candidate** explanation (skill on, same profile)
   - **quiz**: 3–5 short-answer or multiple-choice items that require the facts
     in `reference_facts` / `must_preserve` (not trivia about wording)
3. Blind the reader to which text is which (label A/B randomly per topic).

## Session

1. Reader completes the quiz after reading only one explanation per topic.
2. Score each quiz item correct/incorrect against a fixed key.
3. Per topic record: condition (baseline|candidate), score, minutes to finish,
   optional 1-line “blocking confusion” note.

## Pass criteria (protocol v1)

- Report mean accuracy baseline vs candidate and the delta.
- Do **not** claim product success from judge smoke alone.
- A single cohort of ≥5 readers is enough to record risk; larger n before
  marketing claims.

## Score sheet (copy)

| topic_id | condition | items_correct | items_total | minutes | notes |
|---|---|---:|---:|---:|---|
| | baseline / candidate | | | | |

Store completed sheets outside git (PII) or redacted under `eval/quiz/results/`
if you choose to keep them later. This directory is the protocol only.
