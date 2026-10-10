---
name: secrets
description: >-
  Connect external services and keep app credentials scoped. Use before adding
  an API key, OAuth connection, provider setup, or server-side request that
  needs a user's or workspace's credential.
scope: dev
---

# Secrets

## Rule

Credentials belong to the user, organization, workspace, or deployment that
owns them. Reuse the strongest shared connection or credential flow available;
never copy a value into app code or client-visible state.

## Choose the credential source

1. Check the workspace connection catalog first. If the provider is already
   connected, request the app grant and resolve its vault-backed credential
   reference through the workspace-connection API.
2. For OAuth, use the shared authorization and token flow. Do not store access
   or refresh tokens as ordinary settings or API-key values.
3. If the app truly needs its own API key, register it with the shared secrets
   surface. Do not build a parallel key form or storage table.
4. Use deployment configuration only for a secret owned by the deployed app,
   such as a webhook verification secret. A deployment key must not stand in
   for a user's or customer's provider credential.

## Register an app-local API key

Register the key once so Settings can manage it and the app can describe why it
is needed. Supported scopes are `user`, `org`, and `workspace`; choose the
narrowest scope that matches who owns the credential and how the app resolves
it. Put the registration in a server module imported by a loaded server plugin.

```ts
import { registerRequiredSecret } from "@agent-native/core/secrets";

registerRequiredSecret({
  key: "EXAMPLE_SERVICE_API_KEY",
  label: "Example service API key",
  description: "Connects this app to the example service.",
  docsUrl: "https://example.com/api-keys",
  scope: "user",
  kind: "api-key",
  required: true,
});
```

Use `kind: "oauth"` for an OAuth-backed connection and set `oauthProvider` and
`oauthConnectUrl` for the shared Connect flow. Set `required` only when the app
cannot perform its primary workflow without that connection. A validator may
check a key before save; never log or include the value in a validation error.

## Resolve credentials on the server

Resolve credentials only inside server-side actions or server helpers, using
the request's user and organization context. Keep a missing key separate from
a failed credential-store lookup: ask the user to connect the provider only
when the credential is absent; make a store failure retryable.

For an app-local key, use `resolveSecretDetailed()` from
`@agent-native/core/server` in the request context. Check `lookupFailed` before
checking `value`; do not turn a failed lookup into a setup prompt.

Never read a user's or workspace's API key from `process.env`, or add a raw
environment fallback to a scoped lookup. Do not put credentials in action
arguments or results, agent messages or hidden context, application state,
browser storage, client bundles, logs, or error text. Send them only in the
provider request that needs them, and redact provider responses before
returning an error.

## Related skills

- `security` — protect access to app data and external requests.
- `actions` — expose server-side operations to both the agent and UI.
