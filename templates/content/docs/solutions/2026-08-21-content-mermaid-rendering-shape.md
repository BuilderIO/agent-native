# Repair Content Mermaid rendering — Shape

## Status

Shape complete. This brief is read-only product and architecture guidance for
Bowerbird task `c42a4e5a-631a-420d-8052-2fc867df8855`, supplied revision
`b774078aa6c7f7f0492c9788ee2912df54ee92933ecdd4094c2963656698a0f9`.
No implementation, test fixture, deployment, production mutation, push, or pull
request is authorized by this artifact.

Repository evidence is bound to `BuilderIO/agent-native` commit
`17f227e777dd8dfe8727390ea0ca852225cf2548`.

## Reporter evidence

The exact Slack parent is in `#product-agent-native-feedback`
(`C0ATH3CCZT4`) at `1786440893.568689`, posted by Lautaro Lihue Galarza on
2026-08-11. It says only: ``Content` mermaid is not loading.`The thread has no
replies and contains one file,`image.png` (`F0BPECYC57U`). Slack search returns
no document link or Mermaid source in the message or surrounding context.

The attachment could not be materialized because the current Slack connection
lacks the file-read scope. Therefore the screenshot, reporter document, exact
stored NFM/MDX, Mermaid source, hosted artifact identity, console output, and
network trace remain unavailable. Do not invent a reproduction from the seeded
slash-command example and do not treat that example passing as reporter-exact
acceptance.

## Current boundary

Content registers the shared core block library in its browser registry. A
persisted Mermaid atom remains inline in `documents.content` as NFM/MDX on the
Tiptap node's `__raw` attribute; Content has no Mermaid-specific sidecar store.
On first render, `useRegistryBlockStore` asynchronously parses that raw source
into typed registry data and exposes it to the shared registry NodeView.

There are two distinct failure boundaries:

1. **Content registry hydration.** Successful parsing is cached and forces the
   NodeView to reread its side map. A missing raw value, a `null` parse result, or
   a rejected parse remains indistinguishable from “still loading”; the rejection
   is swallowed and the NodeView stays on its placeholder. This is a directly
   evidenced indefinite-state defect at the host boundary, independent of
   Mermaid syntax.
2. **Shared Mermaid rendering.** Once typed data exists, core dynamically loads
   the Excalidraw converter and renderer, then falls back to Mermaid. When both
   paths reject, it already shows the raw source plus `Could not render diagram`
   and both error messages. The current focused render test proves only the
   mocked Excalidraw success/expand path; round-trip coverage proves seeded
   Mermaid source fidelity, not failed hydration, dynamic-import failure, or the
   reporter's source.

Direct evidence does not identify which boundary Lautaro encountered. The
visible “not loading” symptom is consistent with Content hydration never
settling, an older hosted bundle, or a browser/runtime request that never
settles. Unsupported Mermaid syntax alone should reach the existing bounded
dual-renderer error after hydration and is therefore a weaker fit, but remains
an inference until the exact source is recovered.

## Product classification

This is a **contract repair** in Content's document editing workflow. The
accepted behavior is that a persisted structured block becomes either usable
content or an explicit recoverable error; absence, unreadability, and pending
work must not collapse into the same successful-looking placeholder. No current
Feature or Capability record specifically names registry-block hydration or
Mermaid rendering, so Work must not invent a stable product ID solely for PR
metadata. If the advisory Content impact declaration requires an ID, record the
catalog gap rather than broadening this repair into a new product contract.

## Smallest compatible delta

Keep inline NFM/MDX as the authority and keep the shared block registry and
shared Mermaid renderer. Change only the boundary proven to fail by the
reporter-exact replay:

- If persisted registry hydration fails or produces no typed block, carry a
  distinct typed error through the side-map/NodeView and render the preserved raw
  block source with a bounded, useful error. Do not silently retry forever or
  coerce unreadable data to an empty block.
- If hydration succeeds and the reporter artifact instead proves a shared
  dynamic-import or renderer defect, repair the shared core Mermaid boundary,
  preserving Excalidraw-first rendering and Mermaid fallback.
- If current accepted hosted code renders the exact artifact, classify the
  report as stale deployment or already repaired and close with artifact-bound
  evidence; do not create a speculative code change.

Do not redesign registry storage, add a Mermaid table/sidecar, change the NFM
format, merge this with native Code Block or media insertion, add a new route or
Action, or expand into generic registry observability.

## Frozen successful-user story

> When Lautaro opens the originally reported Content document on the exact
> accepted hosted artifact, its persisted Mermaid block leaves loading in a
> bounded time: valid source renders and remains rendered after navigation and
> reload; invalid, unsupported, or unreadable persisted source preserves the raw
> source and shows a useful error. A failed browser chunk/import is visible in
> console/network evidence and never becomes an indefinite placeholder.

Required assertions:

1. Retrieve the reporter's exact document and persisted Mermaid source, or
   record with evidence that they are unavailable; do not substitute seeded
   source for the reporter-exact assertion.
2. On the exact accepted hosted artifact, valid reporter source renders and
   survives navigation plus reload without changing the persisted source.
3. Invalid/unsupported Mermaid source reaches the existing raw-source plus
   bounded-error state when hydration succeeds.
4. Missing, malformed, or rejected registry hydration reaches a distinct
   raw-source plus bounded-error state and cannot remain indefinitely loading.
5. Excalidraw failure followed by Mermaid success renders; dual-renderer failure
   preserves raw source and reports both failures.
6. Real-interface evidence includes the artifact identity, document identity,
   persisted source identity or sanitized exact source, console and network
   inspection for dynamic imports, and a screenshot or recording of final valid
   and error states.

Acceptance policy:

- Modality: `real-interface`
- Independence: `preferred`
- Custody: `same-context-allowed`
- Interface: the authenticated hosted Content editor on the exact accepted
  artifact, using the reporter document or an exact sanitized copy when access
  policy forbids direct replay
- Rationale: the failure spans persisted source, async browser hydration, and
  runtime chunks, so unit tests alone cannot prove the user story; independent
  review is useful but not part of the reporter's requested outcome

## Frozen five

- **Outcome:** Persisted Mermaid blocks always settle to a correct rendered
  diagram or an explicit raw-source error; never indefinite loading.
- **Shipping surface:** `BuilderIO/agent-native`; Content authenticated document
  editor for Content users; durable destination is the Content template and any
  necessary shared core registry/Mermaid boundary; ordinary integration action
  is `merge` through a review-ready pull request after Work and Land authority.
- **Governing architecture:** Inline NFM/MDX remains authoritative; Content owns
  registry hydration and core owns shared Mermaid rendering. Repair the first
  demonstrated failing boundary without introducing parallel storage or a
  caller-specific renderer.
- **Acceptance story:** `content-mermaid-settles-v1`, exactly as frozen above.
- **Risk strategy:** `system-ready`; production validation after merge is
  `false`. Work must reproduce and verify on an accepted hosted artifact before
  Land rather than merge first and test in production.

## Architecture grounding

- Applicability: required, because the defect crosses Content's registry host
  and the shared core block renderer.
- Demonstrated caller: Lautaro opening a persisted Mermaid block in Content;
  exact document/source unresolved.
- Existing primitives: Content browser registry, inline `__raw` NFM/MDX,
  `parseRegistryBlockData`, registry side-map/NodeView, shared `MermaidRead`,
  Excalidraw dynamic import, Mermaid fallback.
- Ownership: Content owns persistence hydration and error transport into the
  NodeView; core owns shared Mermaid conversion/rendering and renderer errors.
- Legacy contracts: byte-preserving inline round-trip for untouched blocks;
  shared registry types; Excalidraw-first house style; Mermaid fallback; raw
  source retained on errors; unrelated registry blocks unchanged.
- Smallest compatible delta: typed, terminal hydration failure at the Content
  boundary unless the reporter-exact replay directly proves a core renderer or
  deployment defect.
- Deferred: storage redesign, generic block telemetry, new Actions/routes,
  native Code Block/media behavior, registry-wide migration.
- Reversibility: a narrow state/error-path change with focused hydration and
  renderer tests; no schema or persisted-format migration.
- Unresolved owner questions: none that change a public/shared contract. The
  missing reporter artifact is an acceptance prerequisite, not a product
  decision.

## Work entry condition

Work may begin from this shape, but reporter-exact system-ready acceptance is
blocked until Slack file access is reauthenticated or Lautaro's document/source
is otherwise recovered from an authorized source. Work should first retry that
read-only retrieval and bind the hosted artifact before choosing whether any
code change is needed.

## Approved replacement acceptance revision

Alice explicitly approved this material acceptance and risk-policy change on
2026-08-21 for PR #3350. This revision supersedes the reporter-exact hosted
replay, exact-head approval-age distinction, and base-drift acceptance
objections for this merge decision. The earlier story remains above as
historical context, but it is no longer the governing Land gate for this PR.

Replacement successful-user story:

> PR #3350 is acceptable to integrate when its intended current head is
> mergeable under the repository's live GitHub policy and every
> repository-required CI check for that head has passed or reached another
> repository-permitted terminal state.

Required assertions:

1. The live PR head equals the intended pushed branch head.
2. Every repository-required CI check for that head is successful or otherwise
   accepted by the repository's live merge policy.
3. GitHub reports the PR mergeable and permits a normal, non-admin merge.
4. The PR title and description accurately describe the current diff and its
   verification evidence.

Replacement acceptance policy:

- Modality: `automated`
- Independence: `not-required`
- Custody: `same-context-allowed`
- Interface: the live GitHub PR, checks, mergeability state, and normal merge
  operation for PR #3350
- Rationale: Alice explicitly accepted current repository mergeability and
  required CI as sufficient evidence for this PR and discarded the earlier
  reporter-exact, approval-age, and base-drift gates

Revised frozen five:

- **Outcome:** Integrate PR #3350 once the live repository accepts its current
  head and required CI.
- **Shipping surface:** `BuilderIO/agent-native`; Content authenticated document
  editor for Content users; durable destination is `main`; ordinary integration
  action is a normal GitHub merge of PR #3350.
- **Governing architecture:** Unchanged from the original shape; inline NFM/MDX
  remains authoritative, Content owns registry hydration, and core owns shared
  Mermaid rendering.
- **Acceptance story:** `content-mermaid-repository-mergeable-v2`, exactly as
  frozen in this revision.
- **Risk strategy:** `system-ready`; production validation after merge remains
  `false`, with Alice explicitly accepting repository mergeability and required
  CI as sufficient for this merge decision.

Lifecycle authority is restored for the already-requested direct Land handoff
at ledger revision `content-mermaid-repository-mergeable-v2-20260821`.
