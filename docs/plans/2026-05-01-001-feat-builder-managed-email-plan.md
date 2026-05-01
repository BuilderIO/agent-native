---
title: "feat: Builder-managed transactional email"
type: feat
status: blocked
date: 2026-05-01
---

# Builder-Managed Transactional Email

## Overview

Add Builder as a first-class email provider for agent-native apps. This is not an email implementation plan for Resend, SendGrid, or SES inside the framework. It is the agent-native integration plan for an ai-services managed email backend.

The user-facing shape should match the setup direction we want elsewhere:

- Builder-managed is the primary path.
- Bring-your-own provider keys are secondary.
- Local development should work without email provider setup.
- Production/deploy flows should clearly prompt users to enable email before flows like password reset, invite, verification, or app notifications depend on it.

## Status: Blocked

Blocked on ai-services shipping the managed email control plane and send plane described in:

`/Users/steve/Projects/builder/ai-services/packages/docs/content/tech-specs/managed-transactional-email.mdx`

Agent-native should not call SES directly. The framework should only call Builder's managed email API with a scoped send token minted by ai-services.

## Product Defaults

- Email providers are not required for local mode.
- Local/dev auth can continue using existing no-provider behavior.
- Managed email is optional until deploy or until the app uses production email features.
- Setup copy should say email is needed before production features like password resets, verification, invites, and notifications can send.
- Do not recommend Resend over SendGrid or SendGrid over Resend. Both are BYO secondary options.
- Builder-managed email should appear as the primary option when available.
- BYO Resend/SendGrid remains available for users who already have an email provider.

## Backend Contract Expected From ai-services

Agent-native expects these ai-services routes:

| Method | Route                                                     | Purpose                                                                 |
| ------ | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET`  | `/agent-native/managed-email/v1/status`                   | Get enablement, default sender, custom-domain state, and credit status. |
| `POST` | `/agent-native/managed-email/v1/enable`                   | Provision or fetch the managed email tenant and default sender.         |
| `POST` | `/agent-native/managed-email/v1/tokens`                   | Mint a scoped runtime send token for the deployed app.                  |
| `POST` | `/agent-native/managed-email/v1/send`                     | Send a transactional email with the scoped token.                       |
| `GET`  | `/agent-native/managed-email/v1/domains`                  | List sender domains and DNS status.                                     |
| `POST` | `/agent-native/managed-email/v1/domains`                  | Start custom sender-domain verification.                                |
| `POST` | `/agent-native/managed-email/v1/domains/:domainId/verify` | Refresh DNS/SES verification status.                                    |

The runtime app should never receive a Builder private key. It should receive only a send-only token scoped to owner/project/app/environment/sender.

## Runtime Configuration

Add a Builder provider mode to framework email config:

```env
BUILDER_EMAIL_PROVIDER=builder
BUILDER_EMAIL_TOKEN=bme_...
BUILDER_EMAIL_API_BASE_URL=https://ai.builder.io
BUILDER_EMAIL_FROM=notifications@app.example.com
```

Provider resolution order:

1. `BUILDER_EMAIL_PROVIDER=builder` and `BUILDER_EMAIL_TOKEN` means use Builder-managed email.
2. `RESEND_API_KEY` means use Resend.
3. `SENDGRID_API_KEY` means use SendGrid.
4. No provider means dev/no-email behavior.

Do not depend on per-user Builder OAuth credentials for sending email. Password reset routes and other public auth flows can run without a logged-in user, so the app needs a tenant-scoped send token stored as deployment env/workspace secret.

## Setup UX

Replace the current provider-card-heavy email setup with a compact primary/secondary shape:

- Primary row: "Use Builder-managed email"
  - Copy: "Builder sends transactional email for this app. Best for password resets, invites, verification, and production notifications."
  - Button: "Enable"
  - Status states: `not enabled`, `enabling`, `enabled`, `credits paused`, `domain pending`, `domain verified`.

- Secondary row: "Use your own provider"
  - Provider selector: Resend or SendGrid.
  - Neutral copy: "Paste an existing provider key if you already manage email elsewhere."
  - Required env fields shown only for the selected BYO provider.

Setup copy should not imply email is required for local work. A better checklist message:

> Email is optional for local development. Enable it before deploy if this app sends password resets, verification emails, invites, or notifications.

## Deploy-Gated Enablement

Managed email should be created only when clearly needed. Acceptable enable triggers:

- User clicks "Enable Builder-managed email" in setup.
- User enters deploy flow and the app uses auth/email-dependent features.
- Agent detects a production email requirement and asks to enable managed email.

Do not auto-provision email tenants for every created project.

## Framework Email Behavior

Extend the existing framework email abstraction so `sendEmail()` can use Builder-managed email. The app-level email call should stay provider-agnostic.

Expected behavior:

- `isEmailConfigured()` returns true when Builder provider env is present and token is non-empty.
- Password reset sends through Builder provider when configured.
- Verification sends through Builder provider when configured.
- Organization invites and share notifications send through Builder provider when configured.
- If credits are exhausted, the provider returns a structured error and the caller surfaces a clear message.
- Existing Resend and SendGrid behavior remains unchanged.

Do not add feature-specific email code paths. Auth, organizations, sharing, and app notifications should continue to call the framework email helper.

## Credit-Exhausted UX

When ai-services returns 402:

- Do not claim that email was sent.
- Show a quiet but visible message near the relevant flow.
- Suggested copy:

> Email is enabled for this app, but Builder credits are currently exhausted. Emails will resume when credits are available.

In the setup checklist, show email as connected but paused:

- Connected provider: Builder
- Status: Paused, credits required
- Action: link to Builder billing/credits page when available

## Custom Domain UX

v1 agent-native setup should expose only the minimum domain status needed:

- Default Builder-managed sender is available.
- Custom sender domain is not configured.
- Custom sender domain is pending DNS.
- Custom sender domain is verified.
- Custom sender domain is restricted or disabled.

DNS record editing can live in Builder-hosted management UI if that is easier for v1. Agent-native only needs a status card and a link/button to manage sender domain.

## BYO Provider Fallback

Keep BYO Resend and SendGrid:

```env
RESEND_API_KEY=...
RESEND_FROM_EMAIL=...
SENDGRID_API_KEY=...
SENDGRID_FROM_EMAIL=...
```

Provider UI should be neutral:

- Do not describe one provider as preferred.
- Do not use "recommended" badges for BYO providers.
- Do not show large cards for every possible provider.
- Use one compact provider selector and reveal only relevant env fields.

## Docs Updates

After backend exists, update:

- `packages/core/docs/content/onboarding.md`
- `packages/core/docs/content/authentication.md`
- `packages/core/docs/content/deployment.md`
- `packages/core/docs/content/notifications.md`

Docs should say:

- Local mode does not require email.
- Production password reset, verification, invites, and notifications need an email provider.
- Builder-managed email is the easiest hosted path.
- Resend and SendGrid are BYO alternatives.

## Test Plan

Unit tests:

- Email provider resolution chooses Builder when `BUILDER_EMAIL_PROVIDER=builder`.
- Resend and SendGrid continue to resolve as before.
- No-provider local/dev behavior is unchanged.
- Builder provider maps normal send success.
- Builder provider maps 402 to a structured credit error.
- Builder provider maps retryable server errors without losing original context.

UI tests:

- Email setup shows Builder-managed as primary.
- BYO provider selector reveals only selected provider fields.
- Local/dev copy does not say email is required.
- Connected but credit-paused state is visually distinct from disconnected state.

Manual QA:

- Local app with no provider can still run auth in dev mode.
- Deployed app with Builder provider sends password reset.
- Organization invite sends through Builder provider.
- Credits exhausted path blocks send and shows the quiet notice.
- Switching to BYO Resend/SendGrid still works.

## Sequencing

1. ai-services managed email spec approved.
2. ai-services hidden endpoints ship behind flags.
3. Agent-native adds Builder provider support in the email abstraction.
4. Agent-native setup UI makes Builder-managed email primary.
5. Deploy flow offers managed email enablement only when needed.
6. Builder internal usage surfaces show `email:*` credit spend.
7. Roll out to internal projects, then allowlist, then general hosted deployments.

## Out Of Scope

- Direct SES usage from agent-native apps.
- Marketing email.
- Email template builder.
- Attachments.
- Inbound email.
- Replacing BYO provider support.
