// Curated language data for the deterministic checkers.
// Reviewed like golden data, additions/removals should be deliberate,
// not incidental to unrelated changes.

// Built-in filler/hedging/marketing lexicon. Overlaps deliberately
// with the repo's own caveman skill filler set (just/really/basically/
// actually/simply) as prior art for what counts as filler in this project.
export const FILLER_PHRASES: readonly string[] = [
  'just',
  'really',
  'basically',
  'actually',
  'simply',
  'quite',
  'very',
  'of course',
  'certainly',
  "i'd be happy to",
  'feel free to',
  'needless to say',
  'it is worth noting that',
  "it's important to note that",
  'as you may know',
  'game-changer',
  'game changer',
  'best-in-class',
  'cutting-edge',
  'seamless',
  'seamlessly',
  'robust',
  'holistic',
  'paradigm shift',
  'revolutionize',
  'revolutionary',
  'world-class',
  'state-of-the-art',
  'unparalleled',
  'synergy',
  'leverage',
  'utilize',
] as const;

// Curated synonym sets for the one-term-one-concept checker. Each set is
// a group of everyday words that are genuinely interchangeable in general
// prose, deliberately conservative, since semantic drift belongs to the
// judge layer, not this lexical check.
export const CONCEPT_SYNONYM_SETS: readonly (readonly string[])[] = [
  ['use', 'utilize', 'employ'],
  ['delete', 'remove', 'erase'],
  ['start', 'begin', 'commence'],
  ['stop', 'halt', 'cease'],
  ['help', 'assist'],
  ['show', 'display'],
  ['change', 'modify', 'alter'],
  ['fix', 'repair'],
  ['big', 'large'],
  ['fast', 'quick', 'rapid'],
] as const;
