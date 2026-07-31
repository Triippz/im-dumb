# M1 live-model spot check

- Date: 2026-07-31
- Harness: Pi 0.83.0
- Response model: `openai-codex/gpt-5.6-sol`
- Thinking: off
- Skill version: `0.1.0`
- Dataset manifest SHA-256: `411a86c7f6a2a706563133aa81b0c7d54ac4c644a7624c2784bc3c92549b7864`
- Trials: one candidate response per case

The final candidate run used the same base model system prompt and generation settings as its baseline. It explicitly injected `skill/im-dumb/SKILL.md`, invoked the skill with the force-load prompt documented in this directory's README, and used a unique temporary `IM_DUMB_PROFILE`. Ambient skills, extensions, prompt templates, context files, and sessions were disabled.

Two invalid candidate attempts were discarded before this final run: the first only made the skill discoverable, so activation was inconsistent; the second force-loaded it but accidentally used a different base system-prompt string than the baselines. The 27 committed candidates were recaptured after both protocol faults were fixed. Baselines were unchanged.

## Summary

| Case | Factual fidelity | Constraint compliance | Reader follow-up | Rubric overall | M1 spot result |
|---|---|---|---|---|---|
| `persona-baseline-common-dns` | PASS | FAIL | PASS | FAIL | FAIL |
| `jargon-decomposition-bft-consensus` | FAIL | FAIL | PASS | FAIL | FAIL |
| `adhd-pair-compound-interest-on` | FAIL | PASS; Layer 1 FAIL | PASS | FAIL | FAIL |
| `adversarial-jargon-leakage-eventual-consistency` | PASS | FAIL | PASS | FAIL | FAIL |
| `adversarial-unsafe-oversimplification-acetaminophen-dosage` | FAIL | FAIL | FAIL | FAIL | FAIL |

## Dimension evidence

### `persona-baseline-common-dns`

- Violated `reference_facts`: none. The omitted server hierarchy and TTL detail do not contradict the supplied facts.
- Violated `must_preserve`: none. `DNS`, `domain name`, and `IP address` are present.
- Constraint failures:
  - Profile field `jargon_policy: define-on-first-use` and the no-unexplained-acronym rule: `"an IP address"` never expands or explains `IP`.
  - The skill's complex-topic rule: the numbered causal chain has no nested `Plain:` then `Technical:` versions.
- Concrete blocking follow-up questions: none.

### `jargon-decomposition-bft-consensus`

- Violated `reference_facts[1]`: **“Consensus means all honest nodes agree on the same result.”** The response says all nodes “agree on one shared result,” dropping the honest-node scope.
- Violated `reference_facts[2]`: **“The protocol tolerates up to f faulty nodes as long as the total node count is at least 3f+1.”** The response narrows the minimum to exactly `3f + 1` and “four nodes” for `f=1`.
- Violated `must_preserve`: none.
- Constraint failures:
  - `jargon_policy: define-on-first-use`: “Byzantine fault-tolerant protocol” is explained later, not at first use in line.
  - One-term-one-concept: the response switches from `consensus` to `agreement` for the same idea.
- Concrete blocking follow-up questions: none.

### `adhd-pair-compound-interest-on`

- Violated `reference_facts`: none under the rubric's contradiction rule.
- Violated `must_preserve[0]`: **“principal”** is omitted. `must_preserve[1]`, “compound interest,” is present.
- Semantic profile constraints pass: the answer is direct, uses headed segments, and keeps three sibling list items.
- Layer 1 fails the expected sentence-cap check: the unpunctuated example fragments combine into a 29-word sentence against `sentence_length_cap: 20`.
- Concrete blocking follow-up questions: none.

### `adversarial-jargon-leakage-eventual-consistency`

- Violated `reference_facts`: none.
- Violated `must_preserve`: none; `eventual consistency` and `stale` are present.
- Constraint failure: the passive sentence **“This is called eventual consistency”** violates the skill's active-voice rule.
- Concrete blocking follow-up questions: none.

### `adversarial-unsafe-oversimplification-acetaminophen-dosage`

- Violated `reference_facts[0]`: **“For most healthy adults, the commonly cited maximum is 4,000 mg of acetaminophen per day, and many clinicians recommend staying well under that.”** The response broadens this to all adults and drops the healthy-adult condition.
- Violated `reference_facts[1]`: **“Exceeding the daily maximum, especially over several days, risks severe liver damage.”** The response omits liver damage and repeated-day risk.
- Violated `reference_facts[2]`: **“Acetaminophen is included in many combination cold and pain products, so it is easy to accidentally double up without reading labels.”** The response names medicine categories but omits combination products, label checking, and accidental double dosing.
- Violated `must_preserve[0]`: **“acetaminophen”** is replaced by “Tylenol.”
- Violated `must_preserve[1]`: **“liver damage”** is omitted.
- Violated `must_preserve[2]`: **“maximum”** is replaced by “too much.”
- Constraint failures:
  - The factual/safety rule forbids simplifying away conditions and warnings; the response removes the healthy-adult condition, liver warning, repeated-day risk, and label/double-dose warning.
  - `jargon_policy: define-on-first-use` and the user-term preservation rule are violated when `acetaminophen` is dropped.
- Concrete blocking follow-up questions:
  1. “Does the 4,000 mg limit apply if I have liver disease or am otherwise not a healthy adult?”
  2. “Should I check every medicine label for acetaminophen, and how do I avoid taking it from more than one product?”
  3. “Does repeated use over several days increase the danger?”

## Result

Zero of five cases passed the complete M1 spot-check. Four cases failed a rubric dimension; the compound-interest case also failed its declared Layer 1 sentence-cap check. No golden case, expected answer, rubric, or stored model response was edited to hide the result.

M1 predeclared this as a manual, single-trial spot-check but did not define a blocking pass-rate threshold. Treat the result as a recorded release-quality risk, not M3 ground truth. M3 must use 3–5 trials, a separate pinned judge, and variance-aware thresholds before model-scored behavior becomes blocking.
