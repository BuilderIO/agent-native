---
name: transactional-email
description: >-
  How to send and style outbound email — sendEmail, the shared renderEmail
  template, brand/logo overrides, and catalog registration. Use when adding an
  email an app sends, restyling or rebranding one, or debugging a send that
  looks wrong or never arrived.
scope: dev
metadata:
  internal: true
---

# Transactional Email

## Rule

Outbound email goes through `sendEmail` from `@agent-native/core/server`, always
with a `templateId` registered via `defineTransactionalEmail`. Presentation is
separate and optional: `renderEmail` gives you the framework's house style, but
`sendEmail` delivers whatever `html` you hand it, unwrapped and unsanitized.

## The four traps

These are the ones that cost real debugging time. Everything else is in the
`transactional-email` docs page.

**1. Per-call brand overrides fail silently; configured ones throw.**
`brandLogoUrl` accepts only an absolute `https://` URL; `brandColor` only a
strict `#rrggbb`. A relative path, `http://`, or a three-digit hex is dropped.
Per-call values fall back with no error, because they usually carry a tenant row
that legitimately has no logo — resolve relative paths against the app URL first,
the way `templates/clips/server/lib/transactional-email-templates.ts` does.
`configureEmailBranding` throws instead, at boot, because somebody set that and
expects it to apply.

Resolution is caller → `configureEmailBranding` → embedded framework logo. To
rebrand the emails the framework sends on the app's behalf (verify signup, magic
link, password reset, org invite, review comments), configure branding from a
server plugin — those have no app-reachable `renderEmail` call site. To replace
the markup rather than the logo, `registerEmailRenderer`. Share notifications
additionally support per-resource resolvers on the sharing registry.

**2. `paragraphs` is not escaped.** `heading`, `footer`, CTA labels, and
`linkBlock` are escaped by `renderEmail`. `paragraphs`, `closingParagraphs`, and
`heroHtml` are injected raw so callers can compose emphasis and links. Wrap every
dynamic value in `emailStrong()` or `emailLink()` — both escape — and run
anything reaching a subject line through a CRLF strip, or a crafted org name
injects headers.

**3. The Agent Native icon is a string match.** When no valid `brandLogoUrl` is
given, the header falls back to `cid:agent-native-logo`; `sendEmail` scans the
outgoing HTML for that literal and attaches the branding PNG only if it appears.
So HTML without that string gets no icon — that is the lever for full rebranding,
and the explanation when an icon shows up on an email you thought was branded.

**4. Readiness has four states, not two.** `getEmailReadiness()` distinguishes
`ready`, `not-configured` (no provider), `misconfigured` (SendGrid without
`EMAIL_FROM`), and `unavailable` (the credential store could not be read). Never
collapse these into a truthy check: an unreadable vault is not an unconfigured
deployment, and reporting it as one hides an outage behind a setup prompt.

## Adding an email

1. Write a renderer returning `{ subject, html, text }`, in
   `server/lib/<name>-email.ts`. Build the body with `renderEmail` unless the
   design genuinely needs custom markup.
2. Register it in `server/lib/emails.ts` with `defineTransactionalEmail`, behind
   an idempotent `register…Emails()` guard, and import that from a server plugin
   so it registers at startup.
3. Export the id as a constant and pass it as `templateId` on the send. Without
   it, every message shares one provider category and per-email open/delivery
   metrics are unattributable.
4. Give `preview` representative dummy data. It runs on demand from Dispatch for
   apps whose data the caller may not be allowed to see, so it must not read the
   database or touch the network.

`templates/forms/server/lib/emails.ts` plus `response-email.ts` is the smallest
complete example.

## Sender identity

Prefer `fromName` over `from` when sending on behalf of a person — a user's own
address in `From` breaks SPF/DKIM for your domain. Use `replyTo` to route
replies. `appSender` only applies when the configured `EMAIL_FROM` is already on
`agent-native.com`; self-hosted deployments keep their own sender and log a
one-time warning explaining the suppression.

## Don't

- Don't add a second render helper alongside `renderEmail` for an app-specific
  look. `registerEmailRenderer` replaces the markup for every email at once;
  `renderBuiltInEmail` wraps it. Per-message tweaks stay per-call arguments.
- Don't call `renderEmail` from inside a registered renderer — it recurses. Call
  `renderBuiltInEmail`.
- Don't add a per-email branding hook to core. That is how share notifications
  ended up with five resolvers and review comments with none. Branding a caller
  omits resolves once, in `email-branding.ts`; extend that instead.
- Don't reach for an environment variable for presentation. Branding and
  renderers are typed calls made from a server plugin; env is for secrets and
  deployment identity.
- Don't send without `text`. Nothing derives it from your HTML on the send path.
- Don't change a registered `id` — it orphans that email's historical metrics.
- Don't hand-write an email in the notifications channel path when the message is
  a real product email. Notifications fan out one-way alerts; a transactional
  email belongs in the catalog.
- Don't swallow a send failure to keep a request green without saying so. Every
  attempt is written to `email_log`; a best-effort send must still record and log
  its error.

## Related Skills

- **secrets** — how `RESEND_API_KEY`, `SENDGRID_API_KEY`, and `EMAIL_FROM` resolve.
- **onboarding** — surfacing email setup in the sidebar checklist.
- **sharing** — share invitations and the `getLogoUrl` branding hook.
- **integration-webhooks** — inbound email, which is a different subsystem.
