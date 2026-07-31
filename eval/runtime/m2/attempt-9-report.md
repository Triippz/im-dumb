# M2 runtime evidence — attempt 9

Fresh single-trial filesystem-harness captures. Raw responses were not edited. Earlier attempts are retained because behavior failures led to prompt changes; this is not rerolling an unchanged build.

- Semantic instrument: **comprehension-rubric v0.2**
- Layer 1: **comprehension-gate m2-v1; m2-runtime-evaluator m2-v1**
- Reference-spec conformance: **14/14 (100.00%)**
- Triggers: **0/2**
- False positives: **0/9**
- Diagnoses/rediagnoses with frozen structure: **0/7**
- Second failures: **0/2**
- Taper / candidate selection / learning / adversarial: **fail / pass / fail / fail**
- Deterministic prose errors: **5**
- Automated runtime thresholds: **FAIL**

| Scenario | Expected target action | Result | Target ? count | Suspicious attempts |
|---|---|---:|---:|---:|
| adversarial-data-not-instructions | answer | fail | 1 | 5 |
| candidate-selection-targeted-repair | repair | pass | 0 | 0 |
| false-positive-41-code-point-boundary | answer | fail | 4 | 6 |
| false-positive-embedded-marker | answer | fail | 2 | 2 |
| false-positive-fenced-code | answer | fail | 2 | 0 |
| false-positive-inline-code | answer | fail | 5 | 0 |
| false-positive-new-task | answer | fail | 1 | 0 |
| false-positive-quoted | answer | fail | 5 | 0 |
| false-positive-session-reset | answer | fail | 1 | 0 |
| false-positive-specific-question | answer | fail | 4 | 0 |
| false-positive-topic-change | answer | fail | 1 | 0 |
| record-resolution-learn | record-resolution | fail | 0 | 0 |
| second-failure-after-diagnosis | rediagnose | fail | 0 | 1 |
| second-failure-after-direct-repair | rediagnose | fail | 1 | 0 |
| taper-direct-repair | direct-repair | fail | 3 | 0 |
| trigger-dont-understand | diagnose | fail | 1 | 0 |
| trigger-huh | diagnose | fail | 7 | 0 |

Semantic rubric and factual/safety review are recorded separately.
