---
title: "Workspace Connections"
description: "Shared provider metadata, grants, and credential refs for connect-once-use-everywhere integrations."
---

# Workspace Connections

Workspace connections are the framework primitive for reusable integration
metadata. They make "connect once, grant apps, reuse credentials" possible
without pretending every provider is fully generic. The workspace/Dispatch
layer records provider accounts once, grants apps such as Brain, Analytics,
Mail, and Dispatch access, and lets each app's UI and agent inspect safe
integration metadata before asking for another credential.

They have three shared pieces:

- A typed provider catalog that templates import to describe the external
  systems they understand.
- A scoped SQL store for connected accounts plus per-app grants, so Dispatch or
  another workspace setup flow can connect Slack, GitHub, Google Drive, Granola,
  or another provider once and then grant individual apps access.
- A conservative provider-reader registry/runtime that standardizes provider
  `search`, `get`, and `listRecent` contracts and calls registered handlers
  through granted workspace connections.
- An app-local boundary: the shared connection owns provider identity,
  credential refs, account metadata, and grants; each app owns the source
  choices and interpretation that only make sense inside that app.

The store records provider ids, account labels, non-secret config, credential
reference names, health state, and grant rows. It does not run OAuth and never
returns secret values. Secret values stay in the credential vault and are
resolved by actions at execution time from the request's user/org/workspace
scope.

That boundary is intentional. What is reusable today is provider identity,
credential-reference resolution, per-app grants, provider readiness, safe
account metadata, and the normalized provider-reader contract. What is not yet
generic is most live provider API reading, OAuth flow ownership, ingestion
cursors, source filters, sync cadence, and domain interpretation. Those stay in
the app that owns the workflow unless a reader implementation is explicitly
promoted to shared.

Dispatch exposes the first control-plane implementation through the
`list-workspace-connections`, `upsert-workspace-connection`, and
`set-workspace-connection-grant` actions. App-specific actions then consume the
same records. Brain uses `list-connection-providers`; Analytics uses
`data-source-status`; future apps should expose the same kind of readiness
summary before asking users for duplicate provider keys.

## Provider Reader Runtime

The provider-reader layer is a contract first, not a promise that every
provider has a shared live reader. Reader definitions describe supported
operations, credential requirements, and implementation status:
`metadata-only`, `template-owned`, or `shared`. The runtime resolves the granted
workspace connection and credential refs for an app, calls a registered handler,
and returns normalized items without exposing secret values.

Initial providers such as Slack, GitHub, Notion, HubSpot, Gmail, Google Drive,
and generic sources have conservative definitions. Most live handlers remain
template-owned today, which means Brain still owns Slack/GitHub ingestion
behavior and Analytics still owns analytics interpretation. Promote a reader to
`shared` only when the provider-specific API calls, pagination, permissions,
and result semantics are truly reusable across templates.

## Provider Catalog

Import the catalog from `@agent-native/core/connections`:

```ts
import {
  getWorkspaceConnectionProvider,
  listWorkspaceConnectionProvidersForTemplate,
  workspaceConnectionProviderSupports,
} from "@agent-native/core/connections";

const brainProviders = listWorkspaceConnectionProvidersForTemplate("brain");
const slack = getWorkspaceConnectionProvider("slack");

if (workspaceConnectionProviderSupports("slack", "messages")) {
  // Offer a Slack source, sync check, or onboarding step.
}
```

The initial provider ids are:

| Provider       | Capabilities                   | Common uses                    |
| -------------- | ------------------------------ | ------------------------------ |
| `slack`        | search, import, messages       | brain, dispatch, analytics     |
| `github`       | search, import, code, docs     | brain, analytics, dispatch     |
| `notion`       | search, import, docs           | brain, content, dispatch       |
| `gmail`        | search, import, messages       | mail, brain, dispatch          |
| `google_drive` | search, import, docs           | brain, content, slides         |
| `hubspot`      | search, import, crm            | analytics, brain, mail         |
| `granola`      | search, import, meetings, docs | brain, calendar, dispatch      |
| `clips`        | search, import, meetings       | brain, clips, videos           |
| `generic`      | search, import, docs           | custom webhooks and file drops |

Credential keys are names only, such as `SLACK_BOT_TOKEN` or `GITHUB_TOKEN`.
Provider metadata must never include actual credential values.

## Connection Store

Import the shared store from `@agent-native/core/workspace-connections`:

```ts
import {
  listWorkspaceConnectionProviderCatalogForApp,
  listWorkspaceConnectionGrants,
  listWorkspaceConnections,
  summarizeWorkspaceConnectionProviderForApp,
  summarizeWorkspaceConnectionProviderReadiness,
  upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant,
  revokeWorkspaceConnectionGrant,
} from "@agent-native/core/workspace-connections";

await upsertWorkspaceConnection({
  id: "team-slack",
  provider: "slack",
  label: "Team Slack",
  accountLabel: "Acme",
  credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
});

await upsertWorkspaceConnectionGrant({
  connectionId: "team-slack",
  appId: "dispatch",
});

const connections = await listWorkspaceConnections({ includeDisabled: true });
const grants = await listWorkspaceConnectionGrants({ appId: "brain" });

const appGrant = summarizeWorkspaceConnectionProviderForApp({
  providerId: "slack",
  appId: "brain",
  connections,
  grants,
});

const readiness = summarizeWorkspaceConnectionProviderReadiness({
  provider: slack!,
  appId: "brain",
  connections,
  grants,
});

const brainCatalog = await listWorkspaceConnectionProviderCatalogForApp({
  appId: "brain",
  templateUse: "brain",
});
```

The `credentialRefs` array points at vault keys; it is not credential storage.
For example, `{ key: "SLACK_BOT_TOKEN", scope: "org" }` tells a granted app to
look up the org-scoped vault secret named `SLACK_BOT_TOKEN` when it needs to
call Slack. Connection-level refs can describe the provider account, and
grant-level refs can narrow or override what a specific app should use.

Connection rows are scoped to the active org when one is present. Without an
org, they are scoped to the authenticated user. Grant rows use the same scope,
which means any member of an org can see org-level grants while other orgs and
personal scopes cannot.

`allowedApps` on a connection is still supported for compatibility:

- `allowedApps: []` means every app in the same scope may use the connection.
- `allowedApps: ["dispatch"]` grants access through the legacy field.
- `workspace_connection_grants` rows add explicit per-app grants alongside the
  legacy field.

Use `revokeWorkspaceConnectionGrant(connectionId, appId)` to remove an explicit
grant. Revoking a grant does not change legacy `allowedApps`; if the app is
still listed there, the connection remains available to that app.

Use `summarizeWorkspaceConnectionProviderForApp()` and
`summarizeWorkspaceConnectionProviderReadiness()` for app-facing status instead
of hand-rolling grant checks. The shared summaries return the stable contract
used by Brain, Analytics, and Dispatch: `grantState`, `grantAvailability`,
safe credential ref names, per-app connection rows, counts for granted/active
connections, and readiness fields such as `readyConnectionCount` and
`missingRequiredCredentialKeys`.

For new app setup screens, prefer
`listWorkspaceConnectionProviderCatalogForApp()` as the higher-level boundary.
It combines the provider catalog, scoped connections, explicit grants,
per-app access summaries, and provider readiness into one safe shape. Apps can
add their own source counts, local health checks, and connector-specific
fields on top without duplicating grant logic.

## How This Complements The Vault

The credential vault answers: "Where is the secret stored, who can access it,
and which apps are granted it?"

Workspace connection provider metadata answers: "Which provider is this, what
can it do, what credential keys might it need, and which templates should offer
it?"

Use both together:

1. Dispatch or another workspace setup flow creates/grants the underlying vault
   secret or OAuth credential reference.
2. The workspace connection store records the provider account, safe metadata,
   credential refs, and app grants.
3. Each app reads provider metadata from the catalog and connection/grant
   summaries from the shared store.
4. The app UI shows readiness: connected, granted but unhealthy, needs grant,
   missing credentials, or metadata-only.
5. App-specific SQL stores only app-specific source ids, cursors, filters,
   sync windows, metric definitions, review rules, and user choices.
6. App actions resolve credentials at execution time through granted connection
   refs and the vault, and never return secret values.

App source connectors should not read deploy-level environment variables as a
fallback for user/org source credentials. Env vars are global to the deployment
and do not express workspace grants. Brain's current source resolver checks
granted workspace connection refs for `appId=brain` first, then backward
compatible Brain-local SQL credentials and registered vault secrets; it does not
fall back to `process.env`.

Agents should use the same summaries as the UI. Before asking for a duplicate
Slack, GitHub, HubSpot, Google, or other provider key, an agent should inspect
the workspace connection catalog or the app's readiness action and prefer a
granted shared connection when one exists. If a connection exists with
`needs_grant`, ask for that app grant instead of asking the user to paste a new
secret.

## Minimal Onboarding Flow

Use a connect-once flow before app-specific source setup:

1. Connect the provider account in Dispatch or the workspace integrations
   surface.
2. Store safe metadata and credential ref names only; put secret values in the
   vault.
3. Grant only the apps that need the provider, such as Brain, Analytics, Mail,
   or Dispatch.
4. In each app, create the app-local source or data source with only the
   provider-specific choices it owns: channels, repositories, polling windows,
   filters, cursors, or sync cadence.
5. Agents inspect readiness and grants before asking for new credentials.

This keeps the UX clean without overclaiming the abstraction: users connect
Slack, GitHub, HubSpot, Google Drive, Granola, and similar providers once, then
choose which apps may use the credential/account metadata. Each app still
decides what data to read, how to read it, and what the data means.

## Build A Reusable Connector Once

When a new provider should work across multiple templates, split the work into
three layers:

1. **Provider metadata:** add or reuse a provider in
   `@agent-native/core/connections`. This is the stable id, display label,
   capability list, recommended template uses, and credential key names.
2. **Workspace connection:** Dispatch or another workspace setup surface stores
   the connected account's safe metadata, status, scopes, `credentialRefs`, and
   app grants through `@agent-native/core/workspace-connections`.
3. **App-local source:** Brain, Analytics, Mail, or another app stores only the
   app-specific choices it owns, such as Slack channels, GitHub repositories,
   HubSpot object filters, sync cursors, or polling cadence.

Do not duplicate OAuth/token storage in each app. The connection record should
say "this is Acme Slack and its token lives at `SLACK_BOT_TOKEN`"; the app-local
source should say "Brain may ingest `#product` and `#dev-fusion` from that
Slack connection." The Slack API handler, cursor, retry policy, and
distillation rules still belong to Brain unless and until those pieces are
promoted to a shared provider-reader implementation.

### Dispatch control-plane setup

Dispatch exposes the current control-plane actions. They write the same shared
store functions an app could call directly from server code:

```ts
// templates/dispatch/actions/upsert-workspace-connection.ts delegates to this.
await upsertWorkspaceConnection({
  id: "team-slack",
  provider: "slack",
  label: "Acme Slack",
  accountId: "T012345",
  accountLabel: "acme",
  status: "connected",
  scopes: ["channels:history", "groups:history"],
  config: {
    teamDomain: "acme",
    preferredChannels: ["product", "dev-fusion"],
  },
  credentialRefs: [
    {
      key: "SLACK_BOT_TOKEN",
      scope: "org",
      provider: "slack",
      label: "Slack bot token",
    },
  ],
});
```

Then grant the apps that should reuse the provider:

```ts
await upsertWorkspaceConnectionGrant({
  connectionId: "team-slack",
  appId: "brain",
});

await upsertWorkspaceConnectionGrant({
  connectionId: "team-slack",
  appId: "analytics",
});
```

Use `allowedApps: []` only when a connection should be available to every app in
the same workspace scope. Prefer explicit grant rows for production setup,
because they make revocation, audit, and per-app readiness easier to explain.

### App consumption boundary

App setup screens and agents should use the high-level catalog helper whenever
they need provider readiness:

```ts
import { listWorkspaceConnectionProviderCatalogForApp } from "@agent-native/core/workspace-connections";

const catalog = await listWorkspaceConnectionProviderCatalogForApp({
  appId: "brain",
  templateUse: "brain",
  provider: "slack",
  includeConnections: "all",
});

const slack = catalog.providers[0];
if (slack.workspaceConnection.grantState === "needs_grant") {
  // Show "Grant Brain access" instead of asking for a second Slack token.
}
if (slack.readiness.status === "needs_credentials") {
  // Show the missing credential ref names, never a secret value.
}
```

App execution code can then resolve credential values from granted
`credentialRefs` through the vault in the active request scope. Brain's
`source-credentials.ts` is the current reference implementation: it lists
workspace connections for the provider, checks `getWorkspaceConnectionAppAccess`
for `appId: "brain"`, merges connection-level and grant-level credential refs,
and reads the first matching scoped vault secret. Other apps should follow that
shape instead of reaching for `process.env`.

## Concrete Provider Examples

### Slack: Brain, Analytics, Dispatch

Use one Slack workspace connection for channel history and messaging-related
workflows:

```ts
await upsertWorkspaceConnection({
  id: "acme-slack",
  provider: "slack",
  label: "Acme Slack",
  accountId: "T012345",
  accountLabel: "Acme",
  status: "connected",
  scopes: ["channels:history", "groups:history", "chat:write"],
  config: {
    teamDomain: "acme",
    channelHints: ["product", "dev-fusion", "customer-success"],
  },
  credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
});

await upsertWorkspaceConnectionGrant({
  connectionId: "acme-slack",
  appId: "brain",
});
await upsertWorkspaceConnectionGrant({
  connectionId: "acme-slack",
  appId: "analytics",
});
await upsertWorkspaceConnectionGrant({
  connectionId: "acme-slack",
  appId: "dispatch",
});
```

- **Brain** stores allow-listed channels, exclusion rules, cursors, and source
  status in `brain_sources`; it resolves `SLACK_BOT_TOKEN` from the granted
  workspace connection before Brain-local credentials.
- **Analytics** should check `data-source-status` for the Slack provider and
  use shared readiness before requesting a Slack credential for channel or
  funnel analysis.
- **Dispatch** owns the setup/grant UX and can use the same connection for
  Slack-triggered routing, notifications, and agent entrypoints.

### HubSpot: Analytics, Brain, Mail

Use one HubSpot private app token for CRM records that multiple apps can
interpret differently:

```ts
await upsertWorkspaceConnection({
  id: "acme-hubspot",
  provider: "hubspot",
  label: "Acme HubSpot",
  accountLabel: "Acme CRM",
  status: "connected",
  scopes: ["crm.objects.contacts.read", "crm.objects.companies.read"],
  config: {
    portalId: "1234567",
    objectHints: ["companies", "contacts", "deals"],
  },
  credentialRefs: [{ key: "HUBSPOT_PRIVATE_APP_TOKEN", scope: "org" }],
});

for (const appId of ["analytics", "brain", "mail"]) {
  await upsertWorkspaceConnectionGrant({
    connectionId: "acme-hubspot",
    appId,
  });
}
```

- **Analytics** is the first consumer for CRM metrics, lifecycle dashboards, and
  customer segmentation. Its readiness action should show a HubSpot workspace
  connection before asking for duplicate CRM secrets.
- **Brain** can ingest selected customer-facing context, policies, and product
  rationale derived from CRM workflows while keeping Brain-specific allow-lists
  and proposal gates in Brain SQL.
- **Mail** should use the same workspace connection pattern when adding CRM
  enrichment to mailbox workflows. The provider catalog already recommends
  `hubspot` for `mail`; a Mail readiness action should call
  `listWorkspaceConnectionProviderCatalogForApp({ appId: "mail" })` before
  prompting for a HubSpot token.

### GitHub: Brain, Analytics, Dispatch

Use one GitHub connection for repositories, issues, pull requests, and code
context:

```ts
await upsertWorkspaceConnection({
  id: "acme-github",
  provider: "github",
  label: "Acme GitHub",
  accountLabel: "acme",
  status: "connected",
  scopes: ["contents:read", "issues:read", "pull_requests:read"],
  config: {
    owner: "acme",
    repositoryHints: ["agent-native", "website"],
  },
  credentialRefs: [{ key: "GITHUB_TOKEN", scope: "org" }],
});

await upsertWorkspaceConnectionGrant({
  connectionId: "acme-github",
  appId: "brain",
});
await upsertWorkspaceConnectionGrant({
  connectionId: "acme-github",
  appId: "analytics",
});
await upsertWorkspaceConnectionGrant({
  connectionId: "acme-github",
  appId: "dispatch",
});
```

- **Brain** can turn issues, pull requests, and design discussions into cited
  product memory, with app-local repo allow-lists and distillation rules.
- **Analytics** can use the same granted token for engineering throughput,
  release, and operational dashboards.
- **Dispatch** can route GitHub-related questions to the right app or connected
  agent without owning repository-specific ingestion state.

## Consumer Guide By Surface

| Surface       | What it should read                                     | What it should store locally                                      |
| ------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| **Dispatch**  | Full provider catalog, connections, grants, app targets | Workspace setup policy, grant choices, safe account metadata      |
| **Brain**     | Catalog helper with `{ appId: "brain" }`                | Sources, allow-lists, cursors, extraction rules, proposals        |
| **Analytics** | `data-source-status` plus workspace provider summaries  | Metric definitions, datasets, sync windows, dashboard choices     |
| **Mail**      | A Mail readiness action using the same catalog helper   | Mailboxes, labels, reply rules, CRM enrichment preferences        |
| **Agents**    | App readiness actions before asking for secrets         | No secret values; only cite provider ids, grant state, next steps |

Analytics data sources are app-owned even when their credentials come from a
workspace connection. A HubSpot or GitHub grant tells Analytics which provider
account it may use; the Analytics app still owns the source-of-truth decision,
warehouse-vs-live-provider choice, metric definitions, dashboard semantics, and
saved analyses.

Brain's "ask across everything" direction should be federated rather than
centralized. Brain can answer from reviewed Brain knowledge and raw captures it
is allowed to search. When a question needs live app-owned data such as current
analytics metrics, mail state, calendar availability, or Dispatch runtime
policy, Brain should delegate to the specialized app agent or action and cite
that result instead of trying to own every app's reader locally.

Agents should follow a simple rule: if a user asks to connect Slack, GitHub,
HubSpot, Gmail, Google Drive, Granola, or another shared provider, inspect the
workspace connection catalog first. If the provider is `connected`, use it. If
it is `needs_grant`, ask for or perform the app grant. If it is
`needs_credentials`, ask for the missing vault key. Only ask for a new raw key
when no reusable connection exists.

## App Readiness Pattern

Apps that consume shared provider credentials should expose a read-only
readiness action and a small setup surface:

- **Provider catalog:** provider id, label, capabilities, recommended template
  uses, and required credential key names from `@agent-native/core/connections`.
- **Workspace summary:** connection count, active/granted counts, connection
  statuses, grant state, credential ref names, and non-secret account labels
  from `@agent-native/core/workspace-connections`. Use
  `summarizeWorkspaceConnectionProviderForApp()` for this shape.
- **Provider readiness:** use
  `summarizeWorkspaceConnectionProviderReadiness()` when the UI needs the
  provider-level `ready`, `needs_credentials`, `needs_attention`, `checking`,
  `disabled`, or `not_configured` status.
- **Credential health:** whether required keys can be resolved without exposing
  values.
- **Source state:** app-local configured sources, cursors, sync status, and
  next action.

Brain's Sources page is the reference implementation. It shows reusable
workspace connection providers beside Brain source records, labels grant states
as `connected`, `granted`, `needs_grant`, or `not_connected`, and shows provider
health as ready, missing keys, grant needed, needs repair, or metadata only.
That lets a Brain user create Slack, Granola, GitHub, Clips, generic, or manual
sources with a clear signal about whether the shared credential path is ready,
grantable, scoped locally, or missing.

## Path To Connect Once, Use Everywhere

The provider catalog and grant store are the foundation for a broader workspace
layer:

- Shared provider ids and capability names keep templates aligned.
- Workspace-level inventory can show which providers are configured across
  Brain, Mail, Analytics, Dispatch, and future apps.
- Connection rows record account labels, status, allowed apps, credential refs,
  and health checks without changing template-facing provider ids.
- Grant rows let a workspace owner connect once, then enable individual apps as
  the workspace adopts them.
- Agents can route work across apps knowing which providers are already
  connected and which apps have grants.
- Federated search can ask for providers with `search`, `docs`, `messages`,
  `meetings`, `crm`, or `code` capabilities instead of hardcoding every app's
  connector list.
- Provider-specific readers, OAuth refresh flows, ingestion checkpoints, and
  app-owned data models can become shared later, but they are not implied by a
  workspace connection today.

Keep the boundary strict: provider metadata is safe to show; credential values
stay in the vault.
