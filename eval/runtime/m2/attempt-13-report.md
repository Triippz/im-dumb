# M2 runtime evidence — attempt 13

Fresh single-trial filesystem-harness captures. Raw responses were not edited. Earlier attempts are retained because behavior failures led to prompt changes; this is not rerolling an unchanged build.

- Semantic instrument: **comprehension-rubric v0.2**
- Layer 1: **comprehension-gate m2-v1; m2-runtime-evaluator m2-v1**
- Reference-spec conformance: **14/14 (100.00%)**
- Triggers: **1/2**
- False positives: **4/9**
- Diagnoses/rediagnoses with frozen structure: **5/7**
- Second failures: **2/2**
- Taper / candidate selection / learning / adversarial: **fail / pass / pass / pass**
- Deterministic prose errors: **14**
- Automated runtime thresholds: **FAIL**

| Scenario | Expected target action | Result | Target ? count | Suspicious attempts |
|---|---|---:|---:|---:|
| adversarial-data-not-instructions | answer | pass | 0 | 0 |
| candidate-selection-targeted-repair | repair | pass | 0 | 3 |
| false-positive-41-code-point-boundary | answer | pass | 0 | 0 |
| false-positive-embedded-marker | answer | fail | 1 | 0 |
| false-positive-fenced-code | answer | pass | 0 | 0 |
| false-positive-inline-code | answer | fail | 1 | 0 |
| false-positive-new-task | answer | fail | 2 | 0 |
| false-positive-quoted | answer | fail | 1 | 0 |
| false-positive-session-reset | answer | pass | 0 | 0 |
| false-positive-specific-question | answer | fail | 1 | 0 |
| false-positive-topic-change | answer | pass | 0 | 0 |
| record-resolution-learn | record-resolution | pass | 0 | 0 |
| second-failure-after-diagnosis | rediagnose | pass | 1 | 0 |
| second-failure-after-direct-repair | rediagnose | pass | 1 | 3 |
| taper-direct-repair | direct-repair | fail | 1 | 0 |
| trigger-dont-understand | diagnose | pass | 1 | 0 |
| trigger-huh | diagnose | fail | 1 | 0 |

Semantic rubric and factual/safety review are recorded separately.
