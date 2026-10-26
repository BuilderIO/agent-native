---
name: hubspot-email
description: >-
  Create, convert, personalize, and validate HubSpot marketing email HTML.
  Use when creating emails, aligning existing frames with HubSpot, adding
  personalization tokens, or exporting HTML, including follow-ups.
---

# HubSpot Email

Use this workflow for HubSpot email requests, including “make sure this aligns
to HubSpot emails” and “add HubSpot tokens.” It replaces the web stack,
interaction, typography, CSS-variable and animation defaults in
`design-generation`. Any HTML frame can export when its content passes
validation; a special frame type or internal marker is not required.

For a review-only assignment, read `hubspot-email-review` and follow its review
workflow directly. Do not author content or delegate another reviewer.

Resolve the relevant design and frame(s) from conversation references, frame
names, and current application state. Use `view-screen` for current navigation,
selection and screens, then `get-design-snapshot` for the relevant source. Do
not require manual frame selection when that context identifies the target.
Apply requests about multiple named frames to those frames; ask for a target
only when the available context leaves materially different choices.

- Create the design if needed, then author complete email HTML with
  `create-file` (`fileType: "html"`) or `generate-design` (`devices: []`, a
  600px-wide `canvasFrames` placement). Use optional `frameType: "hubspot-email"`
  with `<meta name="agent-native:frame-type" content="hubspot-email">` in the
  head to retain email authoring defaults on future edits. Include the leading
  HubSpot header comment containing `templateType: email` and
  `isAvailableForNewContent: true` so new emails are selectable. The leading
  `templateType: email` is required; availability controls template selection
  and is not a compilation requirement.
- Build a fluid 600px container using presentation tables with `cellpadding="0"`,
  `cellspacing="0"`, explicit widths and table-cell padding. Use inline styles
  or simple class rules the exporter can inline. Media-query overrides may
  remain for mobile. Use email-safe font fallback stacks matching the brand.
  Keep a multi-column desktop layout intact at 600px: put its stacking
  breakpoint below 600px. Let long and unbroken words wrap within constrained
  table cells instead of widening the email.
  Do not include scripts, Tailwind/Alpine, external stylesheets, CSS variables,
  flex/grid, absolute positioning, forms, or browser-only interactions.
- Add a nonempty hidden preheader element with `data-email-preheader`. Include
  visible company footer text with `{{ site_settings.company_name }}`,
  `{{ site_settings.company_street_address_1 }}`, `{{ site_settings.company_city }}`,
  and `{{ site_settings.company_state }}`. Include a visible anchor whose href
  is exactly `{{ unsubscribe_link }}` for both Unsubscribe and Preferences links;
  HubSpot uses it for the subscription preferences page. Do not invent a
  `subscription_preferences_url` alias. Optional `unsubscribe_link_single` and
  `unsubscribe_link_all` URLs opt out of this email type or all email;
  `view_as_page_url` opens the web version. Use the
  [official HubL variable reference](https://developers.hubspot.com/docs/cms/reference/hubl/variables).
  Keep footer text and a nonempty unsubscribe label visible outside the preheader,
  including after inherited/class styles. Prefer readable 14px or larger footer
  type with sufficient contrast; 14px is a HubSpot recommendation, not an export
  minimum. Preserve these tokens on follow-ups.
- Use `{{ personalization_token('contact.firstname', 'there') }}` for contact
  personalization, with a literal default and no filters. This export requires
  the function form and rejects direct `contact.*` tokens. HubSpot does not
  support personalization filters in email; CMS/blog examples do not establish
  email support. The
  [official function reference](https://developers.hubspot.com/docs/cms/reference/hubl/functions#personalization-token)
  documents the default argument, and the
  [filter reference](https://developers.hubspot.com/docs/cms/reference/hubl/filters)
  excludes personalization filters in emails. Dynamic CTA defaults must be
  actual absolute HTTP(S), mailto, or tel URLs; empty strings, plain text and
  script/data URLs are not fallbacks. Preserve HubL in exported HTML, never
  fictional customer values. HubL control blocks (`{% ... %}`) are unsupported.
- Verify CTA destinations against the user's approved sources, the referenced
  repository, or official product documentation. Confirm the destination serves
  the CTA's stated purpose; a plausible-looking or reachable URL is not enough.
  Research missing destinations before reporting a remaining user decision;
  do not invent a repository or signup URL and call it finished.
- Hero images are optional. Images you include require publicly reachable HTTPS
  PNG/JPEG/GIF sources, explicit positive pixel width and height, and alt text
  (empty alt only for decorative images). Describe what the rendered image
  actually shows; verify inherited alt text against the preview rather than
  copying a stale description. Private app/blob URLs, SVGs, data/blob
  URLs, relative paths, local assets and CSS background images cannot be handed
  off as reliable email assets; obtain a public email-safe asset or omit it.

To convert an ordinary web frame, use the resolved `designId` and `fileId` to
read its current snapshot. Keep its approved copy, content hierarchy and
branding, and re-author its layout using the email contract above. Save a new
sibling HTML file in the same design with a unique filename; preserve the
source frame. Adding HubSpot tokens or an internal marker alone does not
convert browser layout. Existing email-safe content, including unmarked HTML,
can be refined in place with `edit-design` after a fresh snapshot. Re-read the
saved frame and confirm the original is unchanged after creating a sibling.

After saving, call `export-hubspot-html` with `id` (design id) and the saved
`fileId`. For a conversion that keeps the original business links, pass
`preserveLinksFromFileId` with the original content frame's ID, not a branding
reference or the converted frame itself. This checks destination preservation;
still review link labels and media meaning against the original content.
Fix reported markup/token/image/link problems and retry until validation
succeeds. Then call `take-design-screenshot` once for that exact `designId` and
`fileId`, with `widths: [600, 375]` and `templatePreview: "hubspot-email"`.
This returns both images for visual inspection from one browser allocation.
This opt-in preview uses clearly fake company values and literal contact defaults
in an in-memory HTML copy; source and exported HTML keep their HubL tokens.
Inspect returned `preview.unresolvedTokens` and resolve unsupported expressions
rather than treating their literal text as final layout. This is sample browser
layout evidence, not HubSpot compilation or inbox-rendering proof.
For personalized content, use `sampleContactValues` on this same preview action
to test normal and deliberately long/unbroken names and populated dynamic CTA
fields. Pass an array such as `[{field: "contact.firstname", value: "Alex"}]`,
with at most 8 unique fields and values up to 500 characters. Each `contact.field`
must match a supported `personalization_token` call in the frame. Omit a
field to inspect its literal default. Check `preview.usedContactFields` and
`preview.unresolvedTokens`. Samples are in-memory only: do not create QA frame
copies just to test recipient variants. Include a 320px preview for complex
layouts or long/unbroken text, then repair the email CSS and repeat the affected
samples before the final default 600/375 pass.
Inspect both returned images and their diagnostics
for overflow, clipped copy, broken or distorted images, and unreadable content;
repair problems and render both widths again after layout changes. A successful
HTML export alone does not complete these visual checks. If rendering is
unavailable, report that check as unfinished instead of calling the email ready.

## Optional independent review

After successful export validation and desktop/mobile visual checks, hand off
the HTML with truthful limits. Independent review is optional and runs when the
user explicitly requests it.

For a requested independent review, use `agent-teams` with a short read-only
review task. Put the target/reference IDs, campaign facts, approved destinations
and fresh `index.source.contentHash` fingerprints from
`get-design-surface-index` in the child instructions. These fingerprints are
opaque values, not SHA-256 digests or `versionHash` values. Ask the reviewer to
read `hubspot-email-review`. Child tool access is inherited; read-only is an
instruction rather than an enforced restriction.

Use `read-result` with `waitMs: 20000` to await the requested review, continuing
bounded waits while it is queued or running. Read current target/reference
fingerprints again before relying on its findings. Report an incomplete or
stale review honestly; do not present it as a completed review. The parent owns
any requested repairs and repeats export/affected previews after changes.

Finish concisely with the saved email and verified HTML handoff. Mention actual
remaining gaps or researched CTA decisions; omit unrequested audit/publishing
checklists, canvas coordinates and style inventories. Offer manual import
without claiming HubSpot compilation or inbox fidelity.
