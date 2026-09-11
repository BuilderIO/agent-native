# ADR: Defer `defineIntegration` Until Authority Boundaries Converge

Status: Accepted

Date: 2026-07-19

## Context

Several framework surfaces describe a provider or integration: shared workspace
connections, Dispatch Vault secrets, custom provider APIs, and managed messaging
adapters. They are related, but they do not have one interchangeable authority
model. A generic `defineIntegration(...)` API would imply a shared lifecycle for
credentials, grants, OAuth installation, request dispatch, and user-visible
setup before that lifecycle exists.

The immediate cost would be an attractive abstraction that either bypasses an
existing access check or becomes a thin facade over incompatible stores. The
more serious cost is migration risk: live OAuth and Slack installations cannot
be lost, silently disconnected, or made invisible while an API is normalized.

## Decision

Do not add `defineIntegration` yet. Keep each existing authority in its current
owner and use narrow bridges only where the implementation is demonstrably
shared. A future integration definition must compose existing authority
contracts; it must not replace them with a new credential or access model.

## Authority Boundary Map

| Surface                          | Current authority          | What it owns                                                                                                                  | Boundary for a future abstraction                                                                                                                                       |
| -------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace connections and grants | Core workspace-connections | Shared provider connection metadata, app grants, scoped credential resolution, and readiness                                  | An integration may request a connection only through its app grant. It cannot treat a provider label as access to every workspace credential.                           |
| Dispatch Vault                   | Dispatch                   | Workspace secret lifecycle, requests, approvals, grants, audit, and sync into app credential scopes                           | Vault is a credential-distribution authority, not a provider transport or OAuth-install store. A generic integration API must not bypass Vault approval or audit paths. |
| Custom provider registry         | Core provider-api          | Scoped provider metadata, allowed hosts, auth descriptor, docs links, SSRF validation, and request-time credential resolution | Registry rows describe an allowed outbound API. They do not grant messaging installation, workspace connection, or Vault access by themselves.                          |
| Messaging adapters               | Core integrations          | Signed inbound webhooks, platform identity, managed installations, token health, scopes, queues, and outbound delivery        | A messaging adapter is a runtime channel with its own installation and webhook contract, not just another HTTP provider.                                                |

These boundaries deliberately permit one product to use more than one surface:
for example, a workspace-granted connection can supply provider credentials,
while Dispatch governs a separately shared secret, and a messaging adapter owns
an inbound channel installation. No generic record may collapse those distinct
authorities into one unscoped token reference.

## Consequences

- Core remains the authority for runtime request context, credential resolution,
  SSRF protection, OAuth tokens, workspace-connection grants, and managed
  messaging installations.
- Dispatch remains the authority for Vault policy, approval, audit, and
  distribution. Provider code must consume its scoped credential result rather
  than read Vault records directly.
- Toolkit remains presentation-only. It can render readiness and setup supplied
  by Core adapters, but must not import Core runtime contracts or own provider
  credentials.
- Reusable low-level helpers are still encouraged when they preserve the owner
  of the data and access decision. Examples include OAuth exchange helpers,
  provider response normalization, and a hardened outbound-delivery primitive.

## Deferred Work And Required Follow-ups

### Provider API registration reads

`provider-api-register` has mutation-side authorization for custom-provider
scope. Before making registration a general integration primitive, add and test
equivalent request-context scoping for its list and get operations. The
operations must resolve the caller's user/org context and return only providers
visible in that scope; callers must not be able to select an arbitrary
`scopeId` to enumerate or read another tenant's registry entries.

### Clips Slack migration

Clips currently has a product-specific Slack unfurl installation: its own
`slack_installations` metadata, app-secret token references, `link_shared`
webhook routing, and unfurl-only scopes. Core managed messaging installs use a
different table and encrypted token-bundle format. Do not replace the Clips
path until all of the following are true:

1. The target store preserves the Clips team/app lookup, owner/org access, and
   unfurl-only scopes.
2. Webhook handling can dual-read the new managed installation and the legacy
   Clips row, with the existing row as a fallback until migration completion.
3. Existing app-secret references are imported or safely resolved without
   exposing tokens to route responses.
4. List, status, disconnect, and signed `link_shared` delivery have migration
   coverage using an existing installation.
5. Production telemetry proves that the new read path handles live events
   before legacy rows or secret references are removed.

### Zoom

Zoom is not currently a Core provider-api, workspace-connection, or managed
messaging catalog entry. It is a real OAuth capability in the Calendar template
backed by the Scheduling package's video-provider API and Core OAuth-token
storage. Treat Zoom as a later provider-catalog candidate, not evidence that a
generic integration API already has a common model. Revisit catalog inclusion
only when there is a defined owner for connection grants, credential setup,
token refresh, and the Calendar/Scheduling compatibility contract.

## Revisit Criteria

Reconsider `defineIntegration` only when all of these are satisfied:

1. At least two production consumers share the same lifecycle, not merely a
   provider name or an OAuth exchange endpoint.
2. The API has explicit ports for request context, authorization, credential
   resolution, token storage, outbound-host policy, and audit ownership.
3. Workspace-connection grants, Dispatch Vault policy, custom-provider scope,
   and messaging-install access are represented as distinct inputs or are
   explicitly inapplicable; none is inferred from a provider id.
4. Each migrated surface has a documented compatibility path, dual-read or
   backfill plan where durable data exists, rollback behavior, and focused
   tests for existing installations/connections.
5. The public API can state what it does not own: domain-specific routes,
   provider-specific payloads, app data models, and presentation UI remain with
   the appropriate app or Toolkit adapter.

Until then, prefer focused Core exports and app adapters over a universal
registration API.
