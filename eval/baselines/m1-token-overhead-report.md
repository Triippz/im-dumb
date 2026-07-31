# M1 token-overhead report

- Capture date: 2026-07-31
- Response model: `openai-codex/gpt-5.6-sol`
- Harness: Pi 0.83.0
- Candidate loading: local `im-dumb` skill explicitly injected and invoked
- Skill version: `0.1.0`
- Trial count: 1 per baseline and candidate
- Dataset manifest SHA-256: `411a86c7f6a2a706563133aa81b0c7d54ac4c644a7624c2784bc3c92549b7864`
- Method: Unicode code points / 4; fractional estimates retained
- M1 policy: +30% aggregate and +60% per case are report-only

Generated with `node dist/token-overhead.js` from the 54 capture records in this directory.

```text
Approximate tokens: Unicode code points / 4 (fractional estimates retained)
adhd-pair-compound-interest-off: -63.53% (175.5 -> 64)
adhd-pair-compound-interest-on: 98.24% (56.75 -> 112.5) EXCEEDS +60%
adhd-pair-engine-off: 27.40% (127.75 -> 162.75)
adhd-pair-engine-on: 65.63% (128 -> 212) EXCEEDS +60%
adhd-pair-firewall-off: -63.41% (202.25 -> 74)
adhd-pair-firewall-on: 56.47% (69.5 -> 108.75)
adhd-pair-git-merge-conflict-off: 28.75% (278.25 -> 358.25)
adhd-pair-git-merge-conflict-on: 3.97% (264.75 -> 275.25)
adhd-pair-vaccines-off: -9.34% (83 -> 75.25)
adhd-pair-vaccines-on: -6.97% (61 -> 56.75)
adhd-pair-water-cycle-off: -65.26% (160.5 -> 55.75)
adhd-pair-water-cycle-on: -49.60% (124 -> 62.5)
adversarial-jargon-leakage-eventual-consistency: -42.76% (112.25 -> 64.25)
adversarial-jargon-leakage-hash-collision: -39.79% (243.75 -> 146.75)
adversarial-jargon-leakage-idempotent-endpoints: -65.26% (166.25 -> 57.75)
adversarial-unsafe-oversimplification-acetaminophen-dosage: -50.66% (133.25 -> 65.75)
adversarial-unsafe-oversimplification-bleach-ammonia: -43.77% (148.5 -> 83.5)
adversarial-unsafe-oversimplification-ladder-power-lines: -27.55% (49 -> 35.5)
jargon-decomposition-bft-consensus: 71.37% (60.25 -> 103.25) EXCEEDS +60%
jargon-decomposition-http-idempotency: 6.84% (197.25 -> 210.75)
jargon-decomposition-k8s-oomkilled: -22.92% (108 -> 83.25)
jargon-decomposition-mortgage-apr-apy: 1.32% (75.75 -> 76.75)
jargon-decomposition-myocardial-infarction: 0.40% (62 -> 62.25)
jargon-decomposition-oauth2-client-credentials: 42.30% (193.25 -> 275)
persona-baseline-common-dns: -22.00% (200 -> 156)
persona-baseline-expert-gc: -21.59% (170.25 -> 133.5)
persona-baseline-technical-ok-tcp-handshake: 2.62% (133.5 -> 137)
Aggregate: -12.56% (3784.5 -> 3309)
Ceilings are report-only in M1.
```

The aggregate passes the provisional ceiling and uses fewer estimated tokens than the baseline corpus. Three individual cases exceed +60%; this is recorded, not blocked, under the M1 policy. M3 must recalibrate with 3–5 trials before making Gate 3 blocking.
