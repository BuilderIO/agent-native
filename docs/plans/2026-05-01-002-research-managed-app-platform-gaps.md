---
title: "research: managed app platform gaps after db/auth/email/llm/hosting"
type: research
status: done
date: 2026-05-01
---

# Managed App Platform Gaps After DB/Auth/Email/LLM/Hosting

## Summary

If Builder has managed database, auth, email, LLM, and hosting, the biggest remaining "get apps live" gaps are not payments or ecommerce. The most important missing primitives are the operational platform pieces around a live app:

1. File/object storage.
2. Custom domains, DNS, SSL, and primary-domain UX.
3. Production secrets and environment management.
4. Logs, monitoring, and deploy diagnostics.
5. Basic app analytics.
6. Background jobs and workflow runs.
7. Preview/share controls.
8. Git/export/import.
9. Rollback and production safety.
10. Security and verification checks before publish.

Payments and ecommerce are lower priority. Once secrets, server actions/functions, webhooks, and jobs are solid, Stripe and Shopify are mostly integration/template work rather than core platform blockers.

## Competitive Baseline

### Lovable

Lovable's current surface is broader than app generation plus publish. Lovable Cloud positions itself as a managed runtime with database, auth, storage, edge functions, app connectors, secrets, custom email, usage/cost management, and AI. It also has publish snapshots, custom domains, GitHub sync/export, preview links, project analytics, file generation, browser testing, testing tools, security scanning, collaboration, project comments, workspace knowledge, cross-project references, design systems, and enterprise governance.

Useful lessons:

- Managed cloud should feel like a complete app envelope, not a bag of separate integrations.
- Security and browser verification are part of the publish loop, not optional debugging tools.
- Runtime app connectors and build-time MCP/context connectors should be separate concepts.
- Publish snapshots reduce accidental production changes.
- Direct visual editing and project comments are strong bridges for non-developers.

Avoid copying:

- Brittle GitHub coupling where repo moves/renames break sync.
- Half-stable environment separation. Lovable's Test/Live environment docs say new Cloud projects no longer get that feature after March 24, 2026.
- Connector sprawl without deep typed contracts, auth, observability, and agent/UI parity.

### Bolt

Bolt Cloud is close to Lovable's all-in-one beginner launch story. It bundles hosting, domains, database, auth, file storage, server functions, analytics, and Stripe. Bolt also has `.bolt.host` URLs, domain purchase/connect flows, secrets, logs, file storage buckets, hosting analytics, sharing/collaboration roles, version history, export/download/GitHub restore, and an Expo/mobile path.

Useful lessons:

- Beginner launch products benefit from one visible checklist that includes URL, storage, secrets, logs, and analytics.
- File storage has to exist even if the admin UI starts simple.
- Mobile is a visible competitive surface, but probably not day-one critical for Builder's web-first app path.

### Replit

Replit is strongest on operational deployment. It has Autoscale, Static, Reserved VM, and Scheduled deployments; custom domains with TLS; encrypted secrets; Scheduled Deployments for cron/background jobs; object storage built on GCS; deployment monitoring; logs; resource usage; checkpoints and rollbacks; imports from GitHub, ZIP, Vercel, Bolt, Lovable, and Figma; and a strong native mobile/Expo story.

Useful lessons:

- Logs and monitoring are core deploy product, not support tooling.
- Scheduled jobs are a first-class deployment type.
- Import/export matters for portability and competitive switching.
- Rollback needs a clear story for both code and data.

## Priority Platform Pieces

### P0: File/Object Storage

This is the biggest gap after DB/auth/email/LLM/hosting. Real apps need avatars, uploads, documents, attachments, generated exports, images, videos, and user files.

Builder should provide:

- Per-app buckets.
- Public and private objects.
- Signed upload and download URLs.
- Access-policy helpers integrated with agent-native auth/orgs.
- Agent-friendly helpers for file upload, read, list, delete, and generate.
- Storage usage shown in credits/usage eventually.
- A simple file browser in hosted management UI.

This should be treated as a platform primitive, not a template feature.

### P0: Domains, DNS, SSL, And Primary Domain

Every competitor makes "real URL" part of launch. Builder hosting should include:

- Default `*.builder.cloud` or equivalent app URL.
- Custom domain connect.
- DNS verification status.
- Automatic TLS.
- Primary domain selection.
- Redirects from secondary domains.
- Troubleshooting when DNS is wrong.
- Future optional domain purchase.

Email sender-domain verification should align with app-domain setup where possible, but app domain and email domain should remain separately understandable.

### P0: Secrets And Environment Management

Users will paste Stripe, Shopify, Slack, Twilio, custom API, and other keys. The platform needs:

- Per-app secrets.
- Per-environment secrets.
- Server-only visibility.
- Rotation and deletion.
- Secret-safe collaboration.
- Agent prompts when a feature requires a key.
- A path from "user pasted key" to "server action/function uses key" without leaking it to browser code.

This is the foundation that makes payments and most integrations easy later.

### P0: Logs And Monitoring

Once an app is public, debugging without logs is miserable. Builder should expose:

- Runtime request logs.
- Action/function logs.
- Auth logs.
- Database errors.
- Job logs.
- Deploy/build logs.
- Email send events.
- LLM gateway errors.
- Agent-readable logs for debugging.

Start with simple filtered logs and error summaries. Advanced APM can wait.

### P1: Analytics

Basic analytics have high perceived value and low product complexity:

- Visitors.
- Pageviews.
- Top pages.
- Referrers.
- Countries/devices.
- 404s.
- Request status/duration.
- Simple real-time view.

This can be framed as "is anyone using my app?" rather than a full analytics product.

### P1: Background Jobs And Workflows

Agent-native already has recurring jobs, automations, and queue-like integration patterns. The hosted product needs a live surface:

- Schedule editor.
- Natural-language schedule if feasible.
- Manual "run now".
- Run history.
- Logs.
- Retries.
- Failure alerts.
- Secret/env support.
- Credit/usage accounting later.

This matters for notifications, syncs, reports, reminders, billing tasks, and integrations.

### P1: Preview, Sharing, And Collaboration

Builder should support:

- Temporary public preview links for the running app only.
- Private/internal published app access.
- Collaborator roles.
- Secret-safe behavior for viewers.
- Comments or feedback tied to UI/screens where possible.

Do not expose code, chat, or secrets through preview links.

### P1: Git, Export, And Import

Portability is central to Builder's positioning. Support:

- ZIP export.
- GitHub sync/export.
- Reconnect after repo rename/move.
- Import from GitHub and ZIP.
- Later: import from Vercel, Bolt, Lovable, Replit, and Figma where practical.

Lovable's two-way GitHub sync is useful but brittle. Builder should make repo mobility boring.

### P1: Rollback And Production Safety

Agent-native apps can modify code and database schema, so rollback is not optional.

Needed:

- Code checkpoints.
- Deploy snapshots.
- Clear rollback to previous deploy.
- Clear distinction between code rollback and data rollback.
- Pre-publish checks.
- Additive-schema guidance surfaced in agent/deploy flows.
- Optional database backup before risky deploys.

### P1: Security And Verification Before Publish

Copy the spirit of Lovable's publish gate:

- Browser test before publish.
- Console/network error checks.
- Dependency/security audit.
- Secret leak scan.
- Auth/access-policy checks.
- Database access-scope checks.
- Email/domain/reputation checks where relevant.

Do not overclaim "secure." Present checks as automated guardrails plus residual risk.

### P2: Mobile

Bolt and Replit both have credible Expo/mobile stories. This is a visible competitive gap if "end-to-end app building" includes app-store distribution.

For Builder, mobile can wait behind web deploy essentials. A later path could be:

- Expo template support.
- Phone preview.
- Shared backend/auth/storage/email services.
- Guided TestFlight/App Store/Play Store checklist.

## What Not To Prioritize For V1

- Stripe as a platform primitive. A Stripe key plus server actions, secrets, webhooks, and agent guidance is enough for most early apps.
- Shopify/ecommerce as a core blocker.
- Huge connector catalog before typed actions, auth, logs, and secrets are solid.
- Enterprise governance before the base deploy surface works.
- Full staging/live environments unless Builder can make them stable and understandable from day one.

## Recommended Roadmap Shape

### Managed Platform V1

- Hosting with default domain.
- Managed database.
- Managed auth.
- Managed LLM gateway.
- Managed transactional email.
- Secrets/env vars.
- File/object storage.
- Logs.
- Basic custom domains.
- Publish snapshots and rollback.

### Managed Platform V1.5

- Background jobs/workflows.
- Basic analytics.
- Security and browser verification checks before publish.
- Preview/share links.
- GitHub sync/export.
- Email/custom-domain polish.
- Credits view for email/storage/hosting/db usage categories.

### Managed Platform V2

- Stable staging/prod environments.
- Domain purchase.
- Mobile/Expo path.
- Import from competitor tools.
- Team comments/design systems/governance.
- More runtime app connectors with typed contracts.

## Sources

- [Lovable Cloud](https://docs.lovable.dev/integrations/cloud)
- [Lovable Publish](https://docs.lovable.dev/features/publish)
- [Lovable Custom Domains](https://docs.lovable.dev/features/custom-domain)
- [Lovable GitHub integration](https://docs.lovable.dev/integrations/github)
- [Lovable Analytics](https://docs.lovable.dev/features/analytics)
- [Lovable Browser Testing](https://docs.lovable.dev/features/browser-testing)
- [Lovable Testing Tools](https://docs.lovable.dev/features/testing)
- [Lovable Security](https://docs.lovable.dev/features/security)
- [Lovable Collaboration](https://docs.lovable.dev/features/collaboration)
- [Lovable Test and Live Environments](https://docs.lovable.dev/features/environments)
- [Bolt Cloud](https://support.bolt.new/cloud/bolt-cloud)
- [Bolt Hosting](https://support.bolt.new/cloud/hosting)
- [Bolt Domains](https://support.bolt.new/cloud/domains)
- [Bolt Secrets](https://support.bolt.new/cloud/database/secrets)
- [Bolt Logs](https://support.bolt.new/cloud/database/logs)
- [Bolt File Storage](https://support.bolt.new/cloud/database/file-storage)
- [Bolt Rollback and Backup](https://support.bolt.new/building/using-bolt/rollback-backup)
- [Replit Deployments](https://docs.replit.com/category/replit-deployments)
- [Replit Custom Domains](https://docs.replit.com/cloud-services/deployments/custom-domains)
- [Replit Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets)
- [Replit Scheduled Deployments](https://docs.replit.com/cloud-services/deployments/scheduled-deployments)
- [Replit Object Storage](https://docs.replit.com/cloud-services/storage-and-databases/object-storage)
- [Replit Deployment Monitoring](https://docs.replit.com/cloud-services/deployments/monitoring-a-deployment)
- [Replit Checkpoints and Rollbacks](https://docs.replit.com/core-concepts/agent/checkpoints-and-rollbacks)
- [Replit Import](https://docs.replit.com/core-concepts/project-editor/app-setup/import)
