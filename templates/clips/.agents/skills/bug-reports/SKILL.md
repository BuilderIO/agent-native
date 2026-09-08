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

## Intake limit

Do not present this as anonymous customer intake until a signed intake/upload
token flow exists — the current upload endpoints are owner-scoped, so an
anonymous reporter cannot upload.

## Related skills

- `recording` — the capture and upload path behind `/record`.
- `video-sharing` — why bug-report recordings default to organization
  visibility instead of public.
- `security` — redaction rules for host metadata and diagnostics.
