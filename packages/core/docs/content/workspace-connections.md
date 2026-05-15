---
title: "Workspace Connections"
description: "Shared provider metadata, grants, and credential refs for connect-once-use-everywhere integrations."
---

# Workspace Connections

Workspace connections are the framework path toward "connect once, grant apps,
use everywhere" integrations. The workspace/Dispatch layer records provider
accounts once, grants apps such as Brain, Analytics, Mail, and Dispatch access,
and lets each app's UI and agent inspect safe integration metadata before
asking for another credential.

They have two shared pieces:

- A typed provider catalog that templates import to describe the external
  systems they understand.
- A scoped SQL store for connected accounts plus per-app grants, so Dispatch or
  another workspace setup flow can connect Slack, GitHub, Google Drive, Granola,
  or another provider once and then grant individual apps access.

The store records provider ids, account labels, non-secret config, credential
reference names, health state, and grant rows. It does not run OAuth and never
returns secret values. Secret values stay in the credential vault and are
resolved by actions at execution time from the request's user/org/workspace
scope.

Dispatch exposes the first control-plane implementation through the
`list-workspace-connections`, `upsert-workspace-connection`, and
`set-workspace-connection-grant` actions. App-specific actions then consume the
same records. Brain uses `list-connection-providers`; Analytics uses
`data-source-status`; future apps should expose the same kind of readiness
summary before asking users for duplicate provider keys.

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

This keeps the UX clean: users connect Slack, GitHub, HubSpot, Google Drive,
Granola, and similar providers once, then choose which apps may use that
connection without duplicating secrets or scattering account setup across every
template.

### Dispatch to Brain Slack happy path

For Slack, Dispatch can represent the shared account with:

- `provider: "slack"`
- safe account metadata such as `accountId`, `accountLabel`, scopes, channel
  hints, or team URLs in `config`
- credential refs such as `{ key: "SLACK_BOT_TOKEN", scope: "org" }`
- either `allowedApps: []` for all apps or an explicit
  `workspace_connection_grants` row for `appId: "brain"`

Brain then reads the same grant metadata through `list-connection-providers`
and resolves the token from the vault at execution time. The Brain source
resolver checks granted workspace connection refs before Brain-local credentials
or registered vault secrets, and it intentionally does not fall back to raw
deployment env vars like `process.env.SLACK_BOT_TOKEN`.

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

Keep the boundary strict: provider metadata is safe to show; credential values
stay in the vault.
