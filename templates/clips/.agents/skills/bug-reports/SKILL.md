---
name: bug-reports
description: >-
  The embedded Clips bug-report flow — the `/bug-report` iframe launcher,
  `/record?intent=bug-report` capture, `save-bug-report-context`, and its
  intake limits. Use when embedding bug capture in another product, wiring the
  launcher, or asked to collect customer bug recordings.
---

# Embedded Bug Reports

## Rule

`/bug-report` is an iframe-friendly launcher only. The actual capture runs
top-level at `/record?intent=bug-report`, because browser media capture needs a
top-level user gesture.

## How it works

1. The host page embeds `/bug-report` in an iframe.
2. The launcher stores redacted host metadata through `save-bug-report-context`.
3. Capture opens top-level at `/record?intent=bug-report`.
4. The recording remains the canonical resource and defaults to workspace
   (organization) visibility.

## Hosted anonymous intake

For an unauthenticated reporter, the host backend must first call
`create-recording-intake-link` with an organization service token. Pass only the
returned short-lived URL to the iframe. The signed intake capability permits one
private recording and its upload transport, but it cannot read the Clips
library or mint agent access.

The service token is organization-scoped. The normal recording pipeline resolves
that organization's configured Builder.io Connect or S3-compatible storage, so
storage credentials never enter the iframe. Keep the service token on the host
backend and validate both `event.origin` and `event.source` on completion.

## Related skills

- `recording` — the capture and upload path behind `/record`.
- `video-sharing` — why bug-report recordings default to organization
  visibility instead of public.
- `security` — redaction rules for host metadata and diagnostics.
