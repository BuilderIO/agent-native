---
title: "Workspace Connections"
description: "Shared provider metadata for connect-once-use-everywhere integrations."
---

# Workspace Connections

Workspace connections are the framework path toward "connect once, grant apps,
use everywhere" integrations. The workspace/Dispatch layer records a provider
account once, grants apps such as Brain, Analytics, Mail, and Dispatch access,
and lets each app's agent see the same safe integration metadata before asking
for another credential.

They have two shared pieces:

- A typed provider catalog that templates can import to describe the external
  systems they understand.
- A scoped SQL store for connected accounts plus per-app grants, so Dispatch or
  another workspace setup flow can connect Slack, GitHub, Google Drive, or
  another provider once and then grant individual apps access to that
  connection.

The store records provider ids, account labels, non-secret config, credential
reference names, health state, and grant rows. It does not run OAuth or return
secret values. Secret values stay in the credential vault and are resolved by
actions at execution time from the request's user/org/workspace scope.

Dispatch exposes the first control-plane implementation through the
`list-workspace-connections`, `upsert-workspace-connection`, and
`set-workspace-connection-grant` actions. App-specific actions then consume the
same records. Brain uses `list-connection-providers`; Analytics uses
`data-source-status`; future apps should expose the same kind of readiness
summary rather than asking users for duplicate provider keys.

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

## How This Complements The Vault

The credential vault answers: "Where is the secret stored, who can access it,
and which apps are granted it?"

Workspace connection provider metadata answers: "Which provider is this, what
can it do, what credential keys might it need, and which templates should offer
it?"

Use both together:

1. Dispatch or another workspace setup flow creates/grants the underlying vault
   secret.
2. The workspace connection store records the provider account, safe metadata,
   credential refs, and app grants.
3. Each app reads provider metadata from the catalog and connection/grant
   summaries from the shared store.
4. The app UI shows readiness: connected, granted but unhealthy, needs grant,
   missing credentials, or metadata-only.
5. App-specific SQL stores only app-specific source ids, cursors, filters, and
   user choices.
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

## App Readiness Pattern

Apps that consume shared provider credentials should expose a read-only
readiness action and a small setup surface:

- **Provider catalog:** provider id, label, capabilities, recommended template
  uses, and required credential key names from `@agent-native/core/connections`.
- **Workspace summary:** connection count, active/granted counts, connection
  statuses, grant state, credential ref names, and non-secret account labels
  from `@agent-native/core/workspace-connections`.
- **Credential health:** whether required keys can be resolved without exposing
  values.
- **Source state:** app-local configured sources, cursors, sync status, and
  next action.

Brain's Sources page is the reference implementation. It shows reusable
workspace connection providers beside Brain source records, labels grant states
as `connected`, `granted`, `needs_grant`, or `not_connected`, and shows provider
health as ready, missing keys, grant needed, needs repair, or metadata only.
That lets a Brain user create Slack, Granola, GitHub, Clips, generic, or manual
sources with a clear signal about whether the shared credential path is ready.

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

Keep the boundary strict: provider metadata is safe to show; credential values
stay in the vault.
