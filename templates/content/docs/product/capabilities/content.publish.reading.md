---
record_type: "capability"
spec_version: 2
id: "content.publish.reading"
name: "Public reading"
user_promise: "A shareable reading surface faithfully renders the intended public Content truth."
primary_user_job: "Let readers open a public document quickly and understand the same meaningful content an editor approved."
kind: "surface"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.renderer.typed", "content.access.visibility-closure"]
related_features: ["content.feature.publish-with-confidence"]
roadmap_boundary: "feature"
acceptance_summary: "A cache-safe public shell resolves only public reading data, renders supported Content blocks through the shared semantic pipeline with safe fallbacks, and preserves metadata, accessible navigation, embeds, and portable links without personalized SSR."
proof_requirements:
  [
    "SSR shell, access, cache, metadata, and no-personalization regression tests",
    "Shared renderer fidelity and fallback tests for public blocks, media, and embeds",
    "Browser reading workflow for public, unavailable, and changed-public-content states",
  ]
evidence:
  [
    "../../../app/routes/p.$id.tsx",
    "../../../app/__tests__/public-document-route.test.ts",
  ]
superseded_by: null
last_reviewed: "2026-07-29"
---

# Public reading

## Why this exists

Publication needs a reader, not merely a route that happens to return HTML.

## Example workflow

A visitor opens a public article link, reads a faithful server-rendered shell, uses accessible headings and media fallbacks, and gets an honest unavailable state for a withdrawn page.

## Product contract

- Public SSR remains one impersonal cacheable shell; personal state and authorization branches happen after load, never by cookie-varying the shell.
- The reader uses shared semantic rendering and deliberate fallbacks so public reading, export, and editor meaning do not drift gratuitously.
- Metadata, canonical links, embeds, assets, and accessible navigation reflect the published public closure.
- Missing, withdrawn, or inaccessible public artifacts are explicit states, not stale content or empty success.

## Boundaries and non-goals

Publication owns exact revision choice; this owns rendering that choice. It does not make private editor capabilities public or duplicate the Reader surface.

## Acceptance stories

### Serve a public shell safely

Given a public Page, when an anonymous reader opens it, then the server returns public content without a personalized cache branch and the client may add only viewer-local behavior after load.

### Handle withdrawal honestly

Given a published destination has been withdrawn, when a reader follows its stable URL, then it receives an explicit unavailable page rather than stale prior content.

## Current evidence

Implementation evidence: `app/routes/p.$id.tsx` and `app/__tests__/public-document-route.test.ts` cover current public route behavior. Donor evidence does not yet prove full renderer fidelity, publication-version integration, or all fallback cases, so this record remains `in_progress`.

## Proof plan

1. Test public cache-shell and access invariants against all public route paths.
2. Add renderer fixtures for supported blocks, assets, embeds, and fallbacks.
3. Browser-test public read, unavailable, and updated-public-revision states.

## Open questions

- The public reading typography and optional interactive enhancement set remain open.
