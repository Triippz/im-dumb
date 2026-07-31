# Response captures

This directory holds the manual M1 response captures used by
`src/token-overhead.ts`. Capturing responses is a local, network-using harness
step; the token-overhead script itself makes no model or network calls.

## Capture protocol

For every id in `eval/golden/manifest.json`, save exactly two JSON files here:
one `baseline` response with the skill disabled and one `candidate` response
with `im-dumb` loaded. A useful naming convention is
`<case-id>.baseline.json` and `<case-id>.candidate.json`; the script reads every
`.json` file in this directory and pairs records by `case_id` and `kind`.

1. Pin one harness, response model id/version, and complete generation settings.
   Use the same model, model version, and settings for both members of each
   pair.
2. Run the golden case prompt without the skill and record the baseline.
3. Manually copy `skill/im-dumb/` to `~/.claude/skills/im-dumb/` (or the
   equivalent local skill directory for the recorded harness).
4. Write the case's `profile` object to a temporary JSON file. Start the
   candidate session with `IM_DUMB_PROFILE=/absolute/path/to/temp-profile.json`
   so the candidate uses that case profile rather than the user's real global
   profile.
5. Run the identical prompt with the skill loaded and record the candidate.
   Remove the temporary profile after capture.

M1 records one trial per response (`trial_count: 1`). A single generation is
noisy and is not M3 ground truth. Do not infer model-quality changes from a
small overhead movement; M3 adds repeated trials and variance-aware gates.

## Capture shape

Each file contains one JSON object:

```json
{
  "case_id": "persona-baseline-common-dns",
  "kind": "baseline",
  "model_id": "example-model",
  "model_version": "2026-01-01",
  "date": "2026-02-20",
  "settings": { "temperature": 0, "top_p": 1 },
  "skill_version": "0.1.0",
  "trial_count": 1,
  "dataset_hash": "sha256-of-eval/golden/manifest.json",
  "response": "Captured response text"
}
```

All fields are required. `settings` is an object and must record every setting
that can affect generation. Both records in a pair use the candidate skill
version, including the no-skill baseline, so the comparison can be traced to
one release. Compute `dataset_hash` from the exact manifest bytes used for the
capture:

```sh
shasum -a 256 eval/golden/manifest.json
```

The validator rejects malformed files, unknown or duplicate case ids, missing
pair members, non-1 trial counts, an empty baseline, dataset/skill-version
mismatches, and model id/version/settings differences within a pair.

## Report

From the repository root, after every expected pair has been captured:

```sh
npm run build
node dist/token-overhead.js
# Machine-readable output:
node dist/token-overhead.js --json
```

Optional `--captures`, `--manifest`, and `--skill-version` flags override the
default paths/version for local checks. Without `--skill-version`, the CLI uses
`package.json`'s version.

Token counts are approximate Unicode code points divided by four; fractional
estimates are retained. Per-case overhead is
`(candidate / baseline - 1) * 100`. Aggregate overhead uses summed character
counts, so it is weighted by baseline response size rather than averaging case
percentages.

The report marks corpus aggregate overhead above **+30%** and any case above
**+60%**. These ceilings are report-only in M1: a threshold breach is printed
but does not change the successful CLI exit code. Invalid capture data remains
a hard error.
