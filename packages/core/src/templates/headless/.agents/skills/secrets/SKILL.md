---
name: secrets
description: >-
  Declaratively register API keys and service credentials a template needs so
  they appear in the agent sidebar settings UI and the onboarding checklist.
  Use for any third-party API key (OpenAI, Stripe, Twilio, etc.) and for
  surfacing OAuth connections in the unified settings UI.
scope: dev
metadata:
  internal: true
---

# Secrets Registry

## Non-negotiable rule

Never hardcode credential values. Source, docs, tests, fixtures, prompts, seed
data, and generated extension/app content may mention credential **names** such
as `OPENAI_API_KEY`, but must not contain real API keys, tokens, webhook URLs,
signing secrets, OAuth refresh tokens, or private Builder/customer data.

Secret values are supplied at runtime through deployment configuration, the
encrypted `app_secrets` vault, `saveCredential` / `resolveCredential`, OAuth, or
`${keys.NAME}` substitution. Examples must use obvious placeholders such as
`<OPENAI_API_KEY>` or `${keys.SLACK_WEBHOOK}`, not real-looking copied values.

## When to use

Use this for any external credential your template needs: API keys, service
tokens, webhook secrets. It gives you:

- A sidebar UI entry for each credential (masked input, rotate, test, delete).
- Automatic onboarding-checklist items for `required: true` secrets.
- A stable server-side read API (`readAppSecret`) that decrypts values on
  demand.
- Validator hooks for health-checking keys before save and from a Test button.

## When NOT to use

- OAuth flows that need to run the full authorization code exchange — use
  `@agent-native/core/oauth-tokens` directly to save/refresh tokens. The
  registry can still surface the OAuth connection in the sidebar by
  registering a secret with `kind: "oauth"` — that just delegates status
  lookup to oauth-tokens and renders a Connect button, no `app_secrets` row
  is written.
- Purely process-level env vars that are never user-facing (e.g. `NODE_ENV`,
  deployment flags). Those belong in the onboarding `form` method or the
  `envKeys` list in `core-routes-plugin`.

## Registering a secret

```ts
// server/plugins/register-secrets.ts
import { defineNitroPlugin } from "@agent-native/core/server";
import { registerRequiredSecret } from "@agent-native/core/secrets";

export default defineNitroPlugin(() => {
  registerRequiredSecret({
    key: "OPENAI_API_KEY",
    label: "OpenAI API Key",
    description: "Used for Whisper transcription of your recordings.",
    docsUrl: "https://platform.openai.com/api-keys",
    scope: "user",
    kind: "api-key",
    required: true,
    validator: async (value) => {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${value}` },
      });
      return res.ok
        ? { ok: true }
        : { ok: false, error: `OpenAI rejected the key (HTTP ${res.status})` };
    },
  });
});
```

### OAuth in the unified UI

```ts
registerRequiredSecret({
  key: "GOOGLE_CONNECTED",
  label: "Google account",
  description: "Grants access to Gmail / Calendar APIs.",
  scope: "user",
  kind: "oauth",
  required: true,
  oauthProvider: "google", // must match the provider id in oauth-tokens
  oauthConnectUrl: "/_agent-native/google/auth-url",
});
```

The sidebar shows a Connect button instead of a text input; no `app_secrets`
row is written — status is derived from `hasOAuthTokens("google")`.

## Registered options

| Field              | Type                                    | Purpose                                                                  |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------ |
| `key`              | `string`                                | Env-var style name (`OPENAI_API_KEY`). Also the storage key.             |
| `label`            | `string`                                | Human-readable title in the sidebar.                                     |
| `description`      | `string?`                               | Subtitle under the label.                                                |
| `docsUrl`          | `string?`                               | "Get key" link rendered on the card.                                     |
| `scope`            | `"user" \| "workspace"`                 | Per-user or shared across the active org.                                |
| `kind`             | `"api-key" \| "oauth"`                  | Drives UI and storage behavior.                                          |
| `required`         | `boolean?`                              | When true, an onboarding step is auto-injected.                          |
| `validator`        | `(v) => Promise<boolean \| {ok,error}>` | Runs on save and from the Test button. Never log `v`.                    |
| `oauthProvider`    | `string?` (oauth-kind only)             | Provider id in `oauth-tokens` that backs this entry.                     |
| `oauthConnectUrl`  | `string?` (oauth-kind only)             | URL the Connect button points at.                                        |

## Reading a secret from an action

```ts
import { z } from "zod";
import { defineAction } from "@agent-native/core/action";
import { readAppSecret } from "@agent-native/core/secrets";
import { getRequestUserEmail } from "@agent-native/core/server";

export default defineAction({
  description: "Transcribe an audio file with Whisper",
  schema: z.object({ fileUrl: z.string() }),
  run: async ({ fileUrl }) => {
    const email = await getRequestUserEmail();
    if (!email) throw new Error("Not signed in");

    const stored = await readAppSecret({
      key: "OPENAI_API_KEY",
      scope: "user",
      scopeId: email,
    });
    const apiKey = stored?.value;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set. Configure it in the sidebar settings.",
      );
    }

    // …call OpenAI. NEVER log the key or include it in error messages.
  },
});
```

Rules:

- **Never log the value.** The read layer enforces this server-side; your
  code must do the same.
- **Use env vars only for deploy-level secrets.** If a credential is
  user-scoped, org-scoped, or workspace-scoped, read the scoped vault/credential
  store. Do not add a `process.env` fallback that makes every user inherit one
  deployment's key.
- **Scope matches the registration.** `scope: "user"` → pass the user email.
  `scope: "workspace"` → pass the active `orgId` from
  `getOrgContext(event).orgId`.

## HTTP routes

Core routes plugin mounts these under `/_agent-native/secrets/` automatically:

- `GET /_agent-native/secrets` — list registered secrets with status (`set`
  / `unset` / `invalid`), metadata, and — for set api-keys — the last 4
  characters. Values are never returned.
- `POST /_agent-native/secrets/:key` — body `{ value, scope?, scopeId? }`.
  Runs the registered validator; returns 400 with the error on failure.
- `DELETE /_agent-native/secrets/:key` — remove the stored value.
- `POST /_agent-native/secrets/:key/test` — re-run the validator against the
  currently stored value.

## Storage & encryption

- Values are stored in `app_secrets` (created on-demand; no migration
  needed).
- Encrypted at rest with AES-256-GCM. Key material is derived from
  `<APP_NAME>_SECRETS_ENCRYPTION_KEY` when set (for example,
  `ANALYTICS_SECRETS_ENCRYPTION_KEY`), then `SECRETS_ENCRYPTION_KEY`, then
  `BETTER_AUTH_SECRET`. App-scoped keys are useful when a local multi-app
  workspace connects one app to its production database without replacing the
  shared local authentication secret. If none is set, the framework uses a
  machine-local fallback and logs a one-time warning — set stable key material
  in production and in every runtime that reads the same encrypted data.

## Ad-hoc Keys

Ad-hoc keys are user-created secrets that are not declared by the template.
Users create them through the settings UI or the agent chat to use with
automations and the `web-request` tool. They support `${keys.NAME}`
substitution in outbound HTTP requests.

### Ad-hoc API

Core routes plugin mounts these under `/_agent-native/secrets/adhoc`:

- `GET /_agent-native/secrets/adhoc` — list all ad-hoc keys (name, last 4
  chars, URL allowlist). Values are never returned.
- `POST /_agent-native/secrets/adhoc` — body `{ name, value, urlAllowlist? }`.
  Creates or updates an ad-hoc key.
- `DELETE /_agent-native/secrets/adhoc/:name` — remove an ad-hoc key.

### URL Allowlists

Each ad-hoc key can have a URL allowlist — an array of origin URLs that
restrict where the key's value can be sent. The check is origin-level
(scheme + host + port). If no allowlist is configured, the key can be used
with any URL.

```ts
// Creating a key with an allowlist
POST /_agent-native/secrets/adhoc
{
  "name": "SLACK_WEBHOOK",
  "value": "<SLACK_WEBHOOK_URL_FROM_SETTINGS>",
  "urlAllowlist": ["https://hooks.slack.com"]
}
```

### `${keys.NAME}` Substitution

The `web-request` tool supports `${keys.NAME}` placeholders in the URL,
headers, and body. Substitution happens server-side after the agent emits
the tool call — the raw secret value never enters the agent's context.

```ts
import {
  resolveKeyReferences,
  validateUrlAllowlist,
} from "@agent-native/core/secrets/substitution";

// Resolve all ${keys.NAME} references in a string
const { resolved, usedKeys } = await resolveKeyReferences(
  "Bearer ${keys.API_TOKEN}",
  "user",
  "user@example.com",
);

// Validate a URL against a key's allowlist
const allowed = validateUrlAllowlist(
  "https://hooks.slack.com/services/<WORKSPACE>/<CHANNEL>/<SECRET>",
  ["https://hooks.slack.com"],
);
```

Key resolution falls back from user scope to workspace scope, so users can
override shared keys without breaking automations that reference workspace
defaults.

## Dispatch Vault Access

Dispatch workspaces have a vault access policy for workspace app credentials:

- `all-apps` is the default. Every saved Dispatch vault key is available to
  every workspace app; `sync-vault-to-app` pushes all vault keys to the target
  app.
- `manual` requires explicit per-app grants. Use
  `create-vault-grant` / `grant-vault-secrets-to-app`, then
  `sync-vault-to-app`.

Use `get-vault-access-settings` before deciding whether to create grants, and
use `set-vault-access-settings` only when the user asks to change the policy.

### Key Files (ad-hoc)

| File                                           | Purpose                                     |
| ---------------------------------------------- | ------------------------------------------- |
| `packages/core/src/secrets/substitution.ts`    | `resolveKeyReferences()`, `validateUrlAllowlist()` |
| `packages/core/src/tools/fetch-tool.ts`        | `web-request` tool consuming key references |

## Related skills

- `onboarding` — the setup checklist that required secrets show up in.
- `actions` — where you'll read secrets when calling third-party APIs.
- `authentication` — session scoping; `scope: "user"` uses the session
  email.
- `security` — input validation and never logging secrets.
- `automations` — ad-hoc keys power `${keys.NAME}` in automation web requests.
