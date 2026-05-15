---
title: "Workspace Connections"
description: "Shared provider metadata for connect-once-use-everywhere integrations."
---

# Workspace Connections

Workspace connections are the framework path toward "connect once, use
everywhere" integrations. They have two shared pieces:

- A typed provider catalog that templates can import to describe the external
  systems they understand.
- A scoped SQL store for connected accounts plus per-app grants, so a workspace
  can connect Slack, GitHub, Google Drive, or another provider once and then
  grant individual apps access to that connection.

The store records provider metadata, account labels, non-secret config,
credential reference names, health state, and grant rows. It does not run OAuth
or return secret values. Secret values stay in the credential vault and are
resolved by actions at execution time.

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
  listWorkspaceConnections,
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

const dispatchConnections = await listWorkspaceConnections({
  appId: "dispatch",
});
```

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

## How This Complements The Vault

The credential vault answers: "Where is the secret stored, who can access it,
and which apps are granted it?"

Workspace connection provider metadata answers: "Which provider is this, what
can it do, what credential keys might it need, and which templates should offer
it?"

Use both together:

1. A template reads provider metadata from the catalog.
2. The UI or onboarding flow shows the provider label, capabilities, and needed
   credential key names.
3. Secret values are created or granted through the vault and secret APIs.
4. The workspace connection store records the connected account, safe metadata,
   and app grants.
5. Templates store only app-specific cursors, source ids, and user choices in
   their own SQL tables.
6. Actions resolve credentials at execution time and never return secret values.

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
- Federated search can ask for providers with `search`, `docs`, `messages`,
  `meetings`, `crm`, or `code` capabilities instead of hardcoding every app's
  connector list.

Keep the boundary strict: provider metadata is safe to show; credential values
stay in the vault.
