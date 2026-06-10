---
title: "Workspace Connections"
description: "Shared provider metadata, grants, and credential refs for connect-once-use-everywhere integrations."
---

# Workspace Connections

Workspace connections are the framework primitive for reusable integration metadata. They make "connect once, grant apps, reuse credentials" possible without pretending every provider is fully generic.

## Quickstart {#quickstart}

### The four concepts

- **Connection** — a named provider account (`team-slack`, `acme-hubspot`). Records provider id, account label, status, scopes, and safe config. Never stores secret values.
- **Grant** — permission for a specific app to use a connection. An app without a grant cannot see the connection's credentials.
- **credentialRef** — a pointer to a vault secret (`{ key: "SLACK_BOT_TOKEN", scope: "org" }`). The connection says where the token lives; the vault holds the value.
- **Readiness** — the combined status an app sees: `connected` (granted + credentials present), `needs_grant`, `needs_credentials`, `needs_attention`, or `not_configured`.

### Worked example: Slack

Connect Slack once and grant it to Brain and Analytics:

```ts
import {
  upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant,
} from "@agent-native/core/workspace-connections";

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
```

### What apps call

Before asking a user to paste a new key, check readiness first:

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

## Reference {#reference}

### Provider Catalog

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

Credential keys are names only, such as `SLACK_BOT_TOKEN` or `GITHUB_TOKEN`. Provider metadata must never include actual credential values.

### Connection Store API

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

The `credentialRefs` array points at vault keys; it is not credential storage. For example, `{ key: "SLACK_BOT_TOKEN", scope: "org" }` tells a granted app to look up the org-scoped vault secret named `SLACK_BOT_TOKEN` when it needs to call Slack. Connection-level refs describe the provider account; grant-level refs can narrow or override what a specific app should use.

Connection rows are scoped to the active org when one is present. Without an org, they are scoped to the authenticated user. Grant rows use the same scope.

**Legacy `allowedApps` field:** `allowedApps: []` means every app in the same scope may use the connection; `allowedApps: ["dispatch"]` grants access through the legacy field. Use explicit `workspace_connection_grants` rows for new setup — they make revocation, audit, and per-app readiness easier. `revokeWorkspaceConnectionGrant(connectionId, appId)` removes an explicit grant but does not change legacy `allowedApps`.

Use `summarizeWorkspaceConnectionProviderForApp()` and `summarizeWorkspaceConnectionProviderReadiness()` for app-facing status instead of hand-rolling grant checks. The shared summaries return `grantState`, `grantAvailability`, safe credential ref names, per-app connection rows, and readiness fields such as `readyConnectionCount` and `missingRequiredCredentialKeys`.

For new app setup screens, prefer `listWorkspaceConnectionProviderCatalogForApp()` as the higher-level boundary — it combines the provider catalog, scoped connections, explicit grants, per-app access summaries, and provider readiness into one safe shape.

### How this complements the vault

The credential vault answers: "Where is the secret stored, who can access it, and which apps are granted it?"

Workspace connection provider metadata answers: "Which provider is this, what can it do, what credential keys might it need, and which templates should offer it?"

Use both together:

1. Dispatch (or another workspace setup flow) creates the underlying vault secret or OAuth credential reference.
2. The workspace connection store records the provider account, safe metadata, credential refs, and app grants.
3. Each app reads provider metadata from the catalog and connection/grant summaries from the shared store.
4. The app UI shows readiness: connected, granted but unhealthy, needs grant, missing credentials, or metadata-only.
5. App-specific SQL stores only app-specific source ids, cursors, filters, sync windows, metric definitions, review rules, and user choices.
6. App actions resolve credentials at execution time through granted connection refs and the vault, and never return secret values.

### Provider reader runtime

The provider-reader layer is a contract first, not a promise that every provider has a shared live reader. Reader definitions describe supported operations, credential requirements, and implementation status: `metadata-only`, `template-owned`, or `shared`. The runtime resolves the granted workspace connection and credential refs for an app, calls a registered handler, and returns normalized items without exposing secret values.

Most live handlers remain template-owned today, which means Brain still owns Slack/GitHub ingestion behavior and Analytics still owns analytics interpretation. Promote a reader to `shared` only when the provider-specific API calls, pagination, permissions, and result semantics are truly reusable across templates.

### App readiness pattern

Apps that consume shared provider credentials should expose a read-only readiness action and a small setup surface covering:

- **Provider catalog:** provider id, label, capabilities, recommended template uses, and required credential key names from `@agent-native/core/connections`.
- **Workspace summary:** connection count, active/granted counts, grant state, credential ref names, and non-secret account labels from `@agent-native/core/workspace-connections`.
- **Provider readiness:** `ready`, `needs_credentials`, `needs_attention`, `checking`, `disabled`, or `not_configured` via `summarizeWorkspaceConnectionProviderReadiness()`.
- **Source state:** app-local configured sources, cursors, sync status, and next action.

Brain's Sources page is the reference implementation. It shows reusable workspace connection providers beside Brain source records, labels grant states as `connected`, `granted`, `needs_grant`, or `not_connected`, and shows provider health as ready, missing keys, grant needed, needs repair, or metadata only.

### Building a reusable connector

When a new provider should work across multiple templates:

1. **Provider metadata:** add or reuse a provider in `@agent-native/core/connections`. This is the stable id, display label, capability list, recommended template uses, and credential key names.
2. **Workspace connection:** Dispatch or another workspace setup surface stores the connected account's safe metadata, status, scopes, `credentialRefs`, and app grants through `@agent-native/core/workspace-connections`.
3. **App-local source:** Brain, Analytics, Mail, or another app stores only the app-specific choices it owns, such as Slack channels, GitHub repositories, HubSpot object filters, sync cursors, or polling cadence.

Do not duplicate OAuth/token storage in each app. The connection record says "this is Acme Slack and its token lives at `SLACK_BOT_TOKEN`"; the app-local source says "Brain may ingest `#product` and `#dev-fusion` from that Slack connection."

### Dispatch control-plane setup

Dispatch exposes control-plane actions that write the same shared store functions an app could call directly:

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
  config: { teamDomain: "acme", preferredChannels: ["product", "dev-fusion"] },
  credentialRefs: [
    {
      key: "SLACK_BOT_TOKEN",
      scope: "org",
      provider: "slack",
      label: "Slack bot token",
    },
  ],
});

// Then grant the apps that should reuse the provider.
await upsertWorkspaceConnectionGrant({
  connectionId: "team-slack",
  appId: "brain",
});
await upsertWorkspaceConnectionGrant({
  connectionId: "team-slack",
  appId: "analytics",
});
```

Use `allowedApps: []` only when a connection should be available to every app in the same scope. Prefer explicit grant rows for production setup.

### Credential resolution

App execution code resolves credential values from granted `credentialRefs` through the vault in the active request scope. Brain's `source-credentials.ts` is the current reference implementation: it lists workspace connections for the provider, checks `getWorkspaceConnectionAppAccess` for `appId: "brain"`, merges connection-level and grant-level credential refs, and reads the first matching scoped vault secret. Other apps should follow that shape instead of reaching for `process.env`.

## Design notes {#design-notes}

<details>
<summary>Reader-promotion policy and path to "connect once, use everywhere"</summary>

### App-local boundary

The boundary between shared connections and app-local sources is intentional. What is reusable today is provider identity, credential-reference resolution, per-app grants, provider readiness, safe account metadata, and the normalized provider-reader contract. What is not yet generic is most live provider API reading, OAuth flow ownership, ingestion cursors, source filters, sync cadence, and domain interpretation. Those stay in the app that owns the workflow unless a reader implementation is explicitly promoted to shared.

App source connectors should not read deploy-level environment variables as a fallback for user/org source credentials. Env vars are global to the deployment and do not express workspace grants.

Agents should follow a simple rule: if a user asks to connect Slack, GitHub, HubSpot, Gmail, Google Drive, Granola, or another shared provider, inspect the workspace connection catalog first. If the provider is `connected`, use it. If it is `needs_grant`, ask for or perform the app grant. If it is `needs_credentials`, ask for the missing vault key. Only ask for a new raw key when no reusable connection exists.

### Path to "connect once, use everywhere"

The provider catalog and grant store are the foundation for a broader workspace layer:

- Shared provider ids and capability names keep templates aligned.
- Workspace-level inventory can show which providers are configured across Brain, Mail, Analytics, Dispatch, and future apps.
- Connection rows record account labels, status, allowed apps, credential refs, and health checks without changing template-facing provider ids.
- Grant rows let a workspace owner connect once, then enable individual apps as the workspace adopts them.
- Agents can route work across apps knowing which providers are already connected and which apps have grants.
- Federated search can ask for providers with `search`, `docs`, `messages`, `meetings`, `crm`, or `code` capabilities instead of hardcoding every app's connector list.
- Provider-specific readers, OAuth refresh flows, ingestion checkpoints, and app-owned data models can become shared later, but they are not implied by a workspace connection today.

Keep the boundary strict: provider metadata is safe to show; credential values stay in the vault.

</details>
