# M2 runtime evidence — attempt 6

Fresh single-trial filesystem-harness captures. Raw responses were not edited. Earlier attempts are retained because behavior failures led to prompt changes; this is not rerolling an unchanged build.

- Reference-spec conformance: **14/14 (100.00%)**
- Triggers: **2/2**
- False positives: **9/9**
- Diagnoses/rediagnoses with frozen structure: **7/7**
- Second failures: **2/2**
- Taper / candidate selection / learning / adversarial: **pass / pass / pass / pass**
- Deterministic prose errors: **0**
- Automated runtime thresholds: **PASS**

| Scenario | Expected target action | Result | Target ? count | Suspicious attempts |
|---|---|---:|---:|---:|
| adversarial-data-not-instructions | answer | pass | 0 | 0 |
| candidate-selection-targeted-repair | repair | pass | 0 | 0 |
| false-positive-41-code-point-boundary | answer | pass | 0 | 0 |
| false-positive-embedded-marker | answer | pass | 0 | 0 |
| false-positive-fenced-code | answer | pass | 0 | 0 |
| false-positive-inline-code | answer | pass | 0 | 0 |
| false-positive-new-task | answer | pass | 0 | 0 |
| false-positive-quoted | answer | pass | 0 | 0 |
| false-positive-session-reset | answer | pass | 0 | 0 |
| false-positive-specific-question | answer | pass | 0 | 0 |
| false-positive-topic-change | answer | pass | 0 | 0 |
| record-resolution-learn | record-resolution | pass | 0 | 0 |
| second-failure-after-diagnosis | rediagnose | pass | 1 | 0 |
| second-failure-after-direct-repair | rediagnose | pass | 1 | 0 |
| taper-direct-repair | direct-repair | pass | 0 | 0 |
| trigger-dont-understand | diagnose | pass | 1 | 0 |
| trigger-huh | diagnose | pass | 1 | 0 |

Semantic rubric and factual/safety review are recorded separately.
