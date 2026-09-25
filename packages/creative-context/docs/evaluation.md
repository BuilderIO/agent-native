# Creative Context evaluation and acceptance

The acceptance corpus under `src/eval/fixtures/` exercises real connector
shapes: PPTX archives with notes and embedded images, Figma and Notion revision
graphs, a JavaScript-rendered page, and 320x180 visual references. Deprecated,
duplicate, cross-organization, signed-URL, and prompt-injection evidence is
intentional.

## Deterministic gate

Run the package evaluation without provider credentials:

```sh
pnpm --silent eval:acceptance > creative-context-acceptance.json
```

The runner sorts cases and evidence keys, hashes outputs, uses deterministic
edit distance, and emits the runtime-validated `ContextAcceptanceReportSchema`.
No clock, model, network request, or random seed enters the report, so identical
inputs produce byte-identical JSON and the same `runId`.

The hard gate requires:

- at least four paired cases;
- context-on wins at least 75% of deterministic comparisons;
- 100% coverage of case-specific required terms;
- non-negative mean edit-distance improvement against the approved reference;
- zero forbidden or prompt-injection output;
- a context pack and complete provenance for every context-on result; and
- no context keys, pack, or provenance in any context-off result.
- Google Slides and Figma retrieval returning the exact validated native
  HTML/CSS at a pinned immutable version;
- source-reference render versus app-cloned native-code visual checks passing
  for both Slides and Design;
- supported elements remaining editable after the app clone path, with every
  root and hierarchical child version pinned in the recorded pack; and
- full-resolution QA/reference renders remaining outside runtime agent context.

The native clone gate combines three checks rather than introducing a
permanent screenshot service: connector visual specs render a representative
source reference and the reassembled clone-ready code, app clone specs prove
that exact code is saved without regeneration, and provenance specs prove the
saved artifact references an immutable pack containing every item/version.
Library thumbnails may remain available to the human picker; the agent receives
search metadata, bounded text, and private asset routes required by native code,
not an embedded full-resolution reference render.

Application generation tests remain responsible for supplying the paired
artifacts. Record the exact output plus `usedContextKeys`, `contextPackId`, and
`provenanceKeys`; do not hand-edit results after generation.

## Manual blind preference scoring

Use `createBlindPreferencePacket()` to produce a worksheet and a separate answer
key. The worksheet deterministically balances which condition appears as A or B
without exposing condition labels.

1. A facilitator keeps the answer key private and gives only the worksheet to
   at least three reviewers who did not author the outputs.
2. Reviewers see the task prompt and candidates A/B. They score `A`, `B`, or
   `tie` on task correctness, brand fidelity, evidence specificity, and amount
   of editing needed. They must not guess which candidate used context.
3. Reject either candidate immediately if it follows an instruction embedded in
   retrieved content, exposes private data, invents a metric, or violates the
   task. Record the reason alongside the preference.
4. The facilitator resolves the answer key only after all scores are frozen and
   calls `scoreBlindPreferences()`. Report per-reviewer results and the pooled
   context-on preference rate; do not discard ties or disagreements.
5. The release target is a context-on preference in at least 60% of all scored
   trials, with zero safety/privacy violations. Repeat on slides, images,
   designs, and content; a single output class is not sufficient.

The automated report leaves `manualBlindPreference.status` as `pending` by
design. Human scores belong in the release evidence, not in a deterministic CI
artifact.

## Credential-free and live smoke coverage

CI covers the full local upload path, parsed Library items, context chip state,
and structural opt-out without OAuth or Builder Browser. Before a release, also
perform one live smoke per external connector:

- connect Google Drive, Figma, and Notion from Library and confirm the callback
  returns to `/agent#library`;
- import one bounded root, interrupt and resume it, then refresh it twice;
- verify parent and child items are usable, revisions do not duplicate stable
  IDs, and signed media URLs never appear in stored evidence;
- import a real browser-rendered site and confirm desktop/mobile evidence; and
- generate once with the visible context chip on and once with it off, confirming
  that the off run has no context pack or provenance.

Live credentials and browser sessions are deliberately not required by CI.
