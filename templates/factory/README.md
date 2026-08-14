# Factory

Factory is the inspectable foundation for building agent factories: work goes
in one end, governed agent work and shipped changes come out the other, with
human intervention points you control. It can start with Slack feedback and
pull-request evidence, then grow to orchestrate product workflows such as
PRD -> design -> engineering -> release.

## What it does

- Polls a configured Slack channel and records new messages with thread and
  coverage metadata.
- Ingests read-only pull-request evidence from the existing ai-services read
  boundary.
- Evaluates editable prompt rules with hard structured guards and stores every
  decision append-only.
- Lets a human correct a decision, tune a rule, or explicitly approve bounded
  work from the Factory UI or the generic Agent-Native Slack bot.
- Starts configured Builder or harness work only through an approval action,
  deduped by Factory item, and reconciles signed callbacks and provider state.
- Surfaces missed callbacks, incomplete evidence, and timeouts as explicit
  states rather than plausible success.

The current implementation is deliberately observe-first and shadow-only.
Sensitive work remains human-gated: auth/session/identity, credentials/vault,
migrations, payments, security, and publishable `packages/*` changes. Factory
does not silently auto-merge, assign, or claim a provider action succeeded
without a terminal record.

## Configure Slack

Set `WORKSPACE_OWNER_EMAIL` to an existing member of the Builder.io organization
that Dispatch uses. Factory does not need a separate organization: startup
finds that existing organization and seeds its organization-owned automations.
If Dispatch synced the vault into a different organization, set
`AGENT_VAULT_ORG_ID` to that existing org id instead of creating a new org.

Connect providers in Dispatch or in Settings -> Integrations. Factory resolves
Slack, GitHub, Sentry, Builder, and other supported provider credentials from
the shared workspace vault and only uses matching deployment env vars as a
last-resort fallback. Factory never stores keys per factory. All apps that read
shared `app_secrets` rows must use the same
`WORKSPACE_SECRETS_ENCRYPTION_KEY` (or the workspace's existing shared
encryption fallback). Never copy raw tokens between apps or add a second
env-only read in a provider client.

Factory's default observer still keeps organization-scoped source metadata -
such as a Slack channel, repository, or Sentry project - for its normalized
queue adapters. That metadata is not a credential or a per-factory integration
setup. GitHub issue polling defaults to hourly; Slack and pull-request checks
use shorter bounded cadences because those sources can need faster feedback.
Every poll preserves errors for reconciliation.

Factory agents can discover connected provider APIs with
`provider-api-catalog`, inspect their docs with `provider-api-docs`, and call
them through `provider-api-request`. Scheduled Factory runs also receive the
workspace's connected MCP tools, subject to the same workspace and request
scope gates. The three normalized pollers are compatibility adapters for the
default triage queue, not the agent's capability limit.

The generic Slack bot is wired to Factory. Mention `@agent-native` in a feedback
thread to inspect the linked item, explain its decision, tune a rule, or say
"do it now" to create an approval-gated run. The bot replies with an
inspectable Factory link when a human decision is required.

## Hosting

Production expects a direct PostgreSQL `DATABASE_URL`,
`WORKSPACE_OWNER_EMAIL`, and `FACTORY_PUBLIC_URL`. `AGENT_VAULT_ORG_ID` is
optional and is only needed when the deployment owner cannot reach the existing
Dispatch vault organization through membership. The Builder executor also
needs `BUILDER_AI_SERVICES_URL` and `BUILDER_PROJECT_ID`; its private key and
signed callback secret belong in Dispatch workspace credentials and are
resolved at runtime. The app remains observe-only until a human explicitly
approves a Factory item.

## Agents and agentic apps

Factory's top-level **Agents** sidebar tab is a shared workspace surface, not a
second registry. It reads mounted agentic apps and their editable Dispatch metadata,
then embeds Dispatch's reusable-agent manager for create, chat, import, and
folder-backed pack editing. A simple agent's profile lives at
`agents/<slug>.md`; its optional context, references, and private skills live
under `agents/<slug>/`. Use the folder import to bring in a Claude Project,
Cowork-style folder, or another text-based agent setup. The importer strips
credentials, hooks, shell commands, and local environment settings, and All-app
imports remain subject to Dispatch approval policy.

The page uses the same two-column library treatment for mounted apps and
reusable agents. Empty states keep creation actions in the content area, and
agent-specific secondary actions live behind each row's overflow menu.

When editing a factory flow, an agent step can bind to either a shared reusable
agent or a ready mounted agentic app from the same workspace database. The map
stores the selected target type and id, while the graph remains a reviewable
blueprint and does not silently change runtime routing.

Use **Build app** on an agent row when the agent needs a full workspace face.
The handoff carries the profile and every pack resource id into app creation;
the original agent remains reusable after the app is created. Mounted apps and
simple agents continue to use the same Dispatch actions, SQL resources, grants,
and application-state navigation.

## Development

```bash
pnpm install
pnpm --filter factory dev
pnpm --filter factory typecheck
pnpm --filter factory test
pnpm --filter factory build
```
