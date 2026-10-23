---
name: hubspot-email-review
description: >-
  Independently review HubSpot email copy, brand, links and responsive previews.
  Use when the user explicitly requests an independent review or delegates a
  read-only review of converted frames or personalized content.
---

# HubSpot Email Review

Return an independent review of the specified saved email. Read the
`hubspot-email` contract for email requirements, then perform this review-only
workflow. Do not spawn another reviewer.

## Establish the reviewed source

Read the assigned target, original content and brand references using
`get-design-snapshot`. Read fresh `get-design-surface-index` results for each
explicit `designId` and `fileId`, with `includeNodes: false` and
`includeReview: false`. Verify `index.source.sourceRef` and compare
`index.source.contentHash` against the expected fingerprints. This value is an
opaque source fingerprint, not a SHA-256 digest or `versionHash`. Missing targets,
missing campaign facts that prevent a judgment, or changed hashes require an
incomplete result, not clearance.

This assignment authorizes reads and in-memory previews only. Do not edit,
create or delete frames, change settings, publish, send messages, or run a
conversion. Snapshot `nextRequiredAction` or edit hints describe capabilities;
they do not authorize writes. Tool access is inherited, so do not claim these
instructions technically enforce read-only access.

## Inspect recipient experience

Call `take-design-screenshot` on the exact target with `templatePreview:
"hubspot-email"` and paired 600px/375px widths. Inspect the returned images and
diagnostics; zero diagnostic counts alone do not establish visual quality. Add
320px for dense cards, long words or personalized content. For personalized
copy or CTA fields, use the action's in-memory `sampleContactValues` array to
check defaults, normal and long/unbroken recipient values. Confirm
`preview.usedContactFields` and `preview.unresolvedTokens`. Never persist sample
values or QA copies. Distinguish raw HubL text in the canvas from resolved
recipient layout; unresolved expressions in the opted-in preview remain a gap.

Review the source and actual pixels against the campaign facts and references:

- Recipient copy carries the intended message. Implementation notes, validation
  instructions, fake test values and unsupported rendering guarantees do not
  belong in the delivered email.
- CTA labels and destinations serve the same purpose. Compare conversions with
  original content links and labels. A reachable URL alone is insufficient.
  Video/play claims, thumbnails and durations require evidence of that actual
  video destination; a static graphic linked to a general landing page is not
  a video. Use approved sources or official research to resolve uncertainty.
- Alt text matches the actual visible image, including reused assets. Check for
  distorted, broken or misleading graphics and invented brand marks.
- Brand, message, hierarchy and content survive conversion. Compare wordmarks,
  palette, typography, image treatment and spacing with the supplied reference;
  preserve original business purposes rather than substituting generic links.
- Desktop columns, mobile stacking, reading order, card padding, button labels,
  long-word wrapping, readable type and footer remain usable at tested widths.
  Check clipping and overflow visually, not only through counts.
- Company information and a visible unsubscribe link remain present. Exported
  source retains supported HubL; browser previews use sample values and do not
  establish HubSpot compilation or real inbox fidelity.

Do not repair an issue yourself. Return concrete findings with the affected
copy, URL, image or viewport and the change needed. If capture or a necessary
source read fails, report the missing evidence instead of inferring a pass.

## Return a source-bound result

Read fresh surface indexes again for the target and references after inspection.
Any changed fingerprint makes the review stale. Return a concise report with:

- The reviewed design/file IDs and opaque source fingerprint.
- The reference IDs/roles and whether their fingerprints stayed unchanged.
- Actual inspected widths and recipient scenarios.
- Concrete issues supported by source or pixels, separating defects from
  optional polish, or a clear finding when the inspected checks pass.
- Any missing evidence or incomplete checks, including the boundary between
  sample browser previews and real HubSpot/inbox testing.

Do not call an incomplete or stale review clear. Return findings to the parent;
the parent owns requested repairs, revalidation and the user handoff.
