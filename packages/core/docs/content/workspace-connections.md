---
title: "Workspace Connections"
description: "Shared provider metadata for connect-once-use-everywhere integrations."
---

# Workspace Connections

Workspace connections are the framework path toward "connect once, use
everywhere" integrations. The first layer is intentionally small: a shared,
typed provider catalog that templates can import to describe the external
systems they understand.

This catalog does not store credentials, run OAuth, persist connection rows, or
return secrets. It gives templates a common vocabulary for provider ids,
credential key names, capabilities, and recommended app uses while the existing
credential vault remains the place where secret values live.

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
3. Secret values are created or granted through the existing vault and secret
   APIs.
4. The template stores only non-secret configuration, cursors, source ids, and
   user choices in its own SQL tables.
5. Actions resolve credentials at execution time and never return secret values.

## Path To Connect Once, Use Everywhere

The provider catalog is the foundation for a broader workspace layer:

- Shared provider ids and capability names keep templates aligned.
- Workspace-level inventory can show which providers are configured across
  Brain, Mail, Analytics, Dispatch, and future apps.
- A later persistence layer can record account labels, status, allowed apps,
  granted credential refs, and health checks without changing template-facing
  provider ids.
- Federated search can ask for providers with `search`, `docs`, `messages`,
  `meetings`, `crm`, or `code` capabilities instead of hardcoding every app's
  connector list.

Keep the boundary strict: provider metadata is safe to show; credential values
stay in the vault.
