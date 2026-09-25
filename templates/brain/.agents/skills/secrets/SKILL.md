---
name: secrets
description: >-
  Declaratively register API keys and service credentials a template needs so
  they appear in the agent sidebar settings UI and the onboarding checklist.
  Use before adding any third-party credential or setup UI so API keys, OAuth
  connections, and scoped configuration use the correct shared primitive.
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

Never write real secrets to non-gitignored files. Put temporary secret material
under the root `.tmp/` or another explicitly gitignored path, then delete it
when it is no longer needed.

Provider secret values are supplied at runtime through the encrypted
`app_secrets` vault, `saveCredential` / `resolveCredential`, OAuth, or
`${keys.NAME}` substitution. Deployment configuration is reserved for
deploy-level secrets and non-provider configuration. Examples must use obvious
placeholders such as `<OPENAI_API_KEY>` or `${keys.SLACK_WEBHOOK}`, not
real-looking copied values.

Provider credentials and provider account identifiers are workspace data. Use
standard workspace connections and org/workspace vault scopes; never put them
in `.env` or deployment environment variables, and never add a provider-specific
action or startup bootstrap just to write a credential for one organization.

## Google OAuth triage

| Observation | Meaning | Next action |
| --- | --- | --- |
| `invalid_grant` from a deliberately fake code | Google accepted the client pair and rejected only the code | Do not rotate credentials; check flow state and callback registration |
| `invalid_client` | Google rejected the client id/secret pair | Verify the exact pair and deployment source before rotating |
| `redirect_uri_mismatch` | The client, host, callback path, and Google registration disagree | Compare that exact tuple in Google Cloud Console; publish a new deploy if site-scoped or build-time configuration changes |

Do not reason about this from memory. The probe checks both contracts: the
unqualified `/health/google` endpoint reports the sign-in contract, while
`/health/google?client=managed` reports deployment-level managed OAuth. It asks
Google directly whether each live `(client_id, redirect_uri)` pair is
registered:

```bash
pnpm check:google-redirect-uris -- --env all
```

The sign-in health path calls `checkGoogleSignInCredential()`, which prefers
the active Better Auth pair and otherwise uses `resolveGoogleSignInCredentials()`
from `packages/core/src/server/google-oauth-credentials.ts`. Managed health
calls `checkGoogleManagedCredential()`, which resolves
`["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]` through `resolveSecretPair()` in
`packages/core/src/server/credential-provider.ts`. App provider handlers use
`resolveGoogleProviderCredentialCandidatesWithReader()` with `resolveSecret`
under request context. These are separate flows and can intentionally land on
different Google clients, so a clean result for one says nothing about the
other. Read both contracts before changing anything:

```bash
curl -s https://HOST/_agent-native/health/google | jq '{clientId,mismatchedPairs,credentialSource}'
curl -s "https://HOST/_agent-native/health/google?client=managed" | jq '{clientId,mismatchedPairs,credentialSource}'
```

Different `clientId` values across those two, or `mismatchedPairs: true`, is a
divergence to understand, not damage to undo. Never repair it by rotating a
secret: writing a fresh value into whichever namespace the failing flow does
not read verifies clean and changes nothing. Do not collapse the namespaces
without first confirming which flow uses which client; separate sign-in and
managed clients on one host can be deliberate. For prebuilt Netlify deploys,
uploaded Functions read site-scoped secrets at runtime, and the health route
resolves them per request. The build may receive masked placeholder values.
After changing a site-scoped env var, publish a new deploy before verifying
live behavior. Call it a rebuild when the changed value is baked into build
output or static assets; a runtime-only secret does not need to be baked into
the bundle.

## Credential Modeling Preflight

Before registering a provider's fields, inspect the workspace/provider connection
catalog first. If a reusable connection exists, use its app grant and scoped
`resolveWorkspaceConnectionCredential(s)ForApp` path instead of registering a
parallel secret. Only classify fields for app-local setup when no reusable
connection exists:

- **API or service key** - register it as `kind: "api-key"` with the narrowest
  correct `scope`, a human label, a description, a docs link, and a validator.
- **OAuth authorization or refresh token** - use the OAuth token store and
  register a `kind: "oauth"` entry so the shared UI renders Connect and the
  runtime owns status, refresh, and reauthorization.
- **Deploy- or app-level configuration** - use deployment/runtime
  configuration, not a per-user secret row. For a non-secret public setting
  already represented by `AgentNativeConfig`, put the default in
  `agent-native.config.ts` and use its `AGENT_NATIVE_CONFIG_<PATH>` alias only
  for a deployment override. Never put a credential or provider key in that
  public namespace.
- **Account, customer, manager, or other non-secret identifier** - store it as
  scoped connection metadata or app data, not as a masked secret field.

`required: true` is for a logical setup requirement. If a provider needs
several values, do not automatically create one required checklist item per
field; use one composite onboarding step or a registered connection readiness
check.

Custom setup UI is allowed for provider-specific prerequisites, ordering, or
health checks, but it must delegate credential storage and connection state to
the shared vault/OAuth/settings surfaces.

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

### Builder.io: organization and personal connections

Builder.io has two OAuth grants per caller, stored apart in
`server/builder-oauth.ts`: the organization's (`org` scope, shared with every
member) and a member's personal one (`user` scope, used only by that member,
ahead of the org's). Name the one you mean; never let role pick it:

- Connect with `/_agent-native/builder/connect?scope=org|personal`. `org` needs
  owner/admin, checked at start and again in the callback, and fails rather
  than landing as a personal grant. `personal` is for members only: owners and
  admins connect for the organization (`canRoleConnectPersonalBuilder`).
- Disconnect with `POST /_agent-native/builder/disconnect` and body
  `{ "scope": "org" | "personal" }`. `org` needs owner/admin; `personal` removes
  only the caller's grant, so they fall back to the org's.
- `/_agent-native/connection-status/builder` returns `grants` (`{}` none,
  `null` unreadable), `effective` (`personal` / `org` / `workspace` / `env` /
  `null`), and `canConnect`. Each grant has `kind`: `oauth`, or `keys` for a
  key pair saved by account activation or an older connect at that scope. Client code reads them from `useBuilderConnectFlow`
  and passes `scope` to `flow.start` and `BuilderConnectionMenu`.
- "Restrict personal API keys" answers in `isPersonalBuilderGrantAllowed`; a
  restricted personal grant stays stored, is skipped for requests, and reports
  `restricted: true`.

A scopeless connect keeps the old rule (owner/admin writes the org grant,
anyone else a personal one) for older clients only.

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
| `usedFor` | `{ appId?, feature, effectWhenRemoved }[]?` | What this app uses the key for. Set `appId` to the app's id; omit it only for every-app uses. |
| `managedBy` | `{ id, owner, route }?` | The Settings page that creates and rotates the key. Its deletes then need `?managedBy=<id>`. |

### What a key powers

Every registered secret should say what it powers, so API keys shows "Used by
{feature}" and remove confirms list what stops. Write `effectWhenRemoved` as the
user-visible outcome ("Uses another image provider, or stops if none is set
up."), not the mechanism.

- A provider key's model use ("Agent", models leaving the picker) is derived
  from the engine registry. Don't add it to `usedFor`.
- Framework-wide uses live in `register-framework-secrets.ts` via
  `registerSecretUsage()`, which survives a template registering the same key.
- Keys an owner flow writes (Builder.io credentials, `S3_*` storage fields,
  channel tokens, calendar tokens) are mapped in `secrets/managed-keys.ts`. A
  registration wins over the map: registering a key puts it on API keys unless
  the registration sets `managedBy`.
- Before deleting a key or removing a provider, call `preview-secret-removal`
  (or `GET /_agent-native/secrets/:key/usage`) and tell the user the effects.

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
- **One resolver per key, and every runtime path goes through it.** Before
  reading a credential, grep the app for the key name. If a resolver already
  exists (`resolveXConfig`, a connector, a client factory), call it — do not
  read `process.env` for that key a second time somewhere else.
- **Identity comes from the caller, not the module.** A shared helper under
  `server/lib/` takes the email as a parameter; only an entrypoint (action,
  route, cron) decides whose identity it is. A library that resolves its own
  identity from `process.env.AGENT_USER_EMAIL` authorizes the deployment rather
  than the caller.

The failure this prevents is not a leak — it is a split brain. When the config
check reads the vault and the feature reads `process.env`, the settings UI and
onboarding checklist report the integration as **configured** while every actual
call fails with "env var is required". The credential is right there in the
vault, so the error names the wrong cause and sends everyone hunting for a sync
or redeploy problem that does not exist. This has now shipped four times in one
app (BigQuery, Jira, Pylon, Academy).

Before finishing any change that touches a credential, run the guard from the
app directory — it finds this whether the app lives in `templates/` or in a
workspace repo:

```bash
npx agent-native doctor --only no-env-credentials
```

## `resolveCredential` sees exactly one organization

`resolveCredential(key, { userEmail, orgId })` checks the user scope, then the
one `orgId` you pass, then the solo workspace. That is the whole search. It is
correct for a signed-in request, and wrong for two common cases:

- **The caller has no organization.** A cron, a scheduled job, or any CLI run
  without a real member identity resolves no `orgId`, so only the user and solo
  scopes are ever consulted — and a shared key is in neither.
- **The key was synced under a different organization.** `app_secrets` has no
  scope visible to every org (`readAppSecret` is strict equality on
  `(scope, scope_id, key)`), so a key the vault UI advertises as available to
  every app is unreadable from any org except the one that ran the sync.

Both produce the same misleading "not set" that the split brain above produces,
which is why swapping `process.env` for `resolveCredential` can look like a fix
and change nothing. A workspace app should read shared keys through a resolver
that also sweeps the caller's other memberships and a designated vault org —
see `resolveConnectorSecret` and `AGENT_VAULT_ORG_ID` in the builder-workspace
repo for the shape, including the boot-time assertion that the deployment really
is single-tenant before a non-membership-gated fallback is safe.

**The doctor guard does not catch this second form** — it looks for
`process.env` reads, and `resolveCredential` is not one. Grep for
`resolveCredential` yourself and confirm each call sits somewhere a single-org
lookup is genuinely the right question. Findings that pair it with a
`?? process.env.KEY` fallback are the sanctioned deploy-level escape hatch; the
bugs are calls whose value can only live in another org's vault.

## HTTP routes

Core routes plugin mounts these under `/_agent-native/secrets/` automatically:

- `GET /_agent-native/secrets` — list registered secrets with status (`set`
  / `unset` / `invalid` / `unknown`), metadata, and — for set or invalid
  api-keys — the last 4 characters. `invalid` means the provider rejected the
  key in effect (`rejectedAt`); it stays until a call with the key succeeds or
  the key is replaced. Values are never returned.
- `POST /_agent-native/secrets/:key` — body `{ value, scope?, scopeId? }`.
  Runs the registered validator; returns 400 with the error on failure.
- `DELETE /_agent-native/secrets/:key` — remove the stored value. A managed
  key returns 409 naming its owner unless the owner passes `?managedBy=<id>`
  (same on `DELETE /secrets/adhoc/:name`). Owner pages call
  `removeManagedSecrets(keys, managerId)` from `@agent-native/core/client`.
- `POST /_agent-native/secrets/:key/test` — re-run the validator against the
  currently stored value.
- `GET /_agent-native/secrets/:key/usage[?scope=]` — the remove-impact
  preview (same result as the `preview-secret-removal` action). List payloads
  carry `usedFor` and `managedBy` for registered and ad-hoc keys.

Model provider keys are checked by listing the models they reach: the
`check-provider-key` action (or `POST /_agent-native/agent-engine/provider-models`,
client helper `fetchProviderModels`) returns `{ ok, models }` or
`{ ok: false, code, reason }`. Call it before saving a key the user gives you;
the key-save route runs the same check and refuses a rejected key.

## Storage & encryption

- Values are stored in `app_secrets` (created on-demand; no migration
  needed).
- Values are encrypted at rest with AES-256-GCM. Generic app-local secrets
  prefer `<APP_NAME>_SECRETS_ENCRYPTION_KEY` (for example,
  `ANALYTICS_SECRETS_ENCRYPTION_KEY`), then `SECRETS_ENCRYPTION_KEY`, then
  `BETTER_AUTH_SECRET`.
- Workspace-shared `app_secrets` prefer
  `WORKSPACE_SECRETS_ENCRYPTION_KEY`, then the legacy shared
  `SECRETS_ENCRYPTION_KEY`, then a purpose-derived key from `A2A_SECRET`.
  Better Auth and app-scoped keys remain legacy read candidates; a successful
  legacy decrypt is compare-and-swap migrated to the preferred shared key
  without changing the row timestamp.
- Set the same stable `WORKSPACE_SECRETS_ENCRYPTION_KEY` in every app that
  reads a shared vault. It is intentionally separate from app-local OAuth
  encryption. If the vault still relies on `A2A_SECRET`, rotating A2A material
  also rotates its encryption key. Add the stable vault key everywhere and
  read/migrate existing rows before rotating A2A.
- To rotate the dedicated workspace key itself, deploy the new value together
  with `WORKSPACE_SECRETS_ENCRYPTION_KEY_PREVIOUS=<old value>`, let reads
  migrate ciphertext, then remove the previous key after the migration window.
- If no configured key material exists, development uses a machine-local
  fallback and logs a one-time warning. Production fails closed.

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
- `DELETE /_agent-native/secrets/adhoc/:name[?scope=user|workspace]` —
  remove an ad-hoc key. Pass the listed row's `scope` when a name is saved
  at both; without it the personal row goes first.

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

## Model provider keys

Save model provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, the other
`PROVIDER_ENV_META` keys, and the OpenAI/Ollama endpoints) with
`saveAgentEngineProviderSettings({ provider, apiKey, scope })`; remove them
with `deleteAgentEngineProviderSettings({ provider, scope })`.

- `scope` defaults to `"user"`. `"org"` needs an owner or admin; a member gets
  403. A caller with no organization saves personally either way, and the
  response's `scope` says which row was written.
- A personal row and an organization row for the same provider coexist. An
  organization save never deletes anyone's personal row, and the resolver
  uses a personal key for its owner only (user before org).
- Provider forms without a scope picker save at organization scope for owners
  and admins and personally for everyone else (`useProviderKeySaveScope`).
  Save stays off until the role is read; a failed read shows a retry and
  never falls back to a personal save. Every provider key registers at `scope: "user"`, so Settings → API keys
  writes the same personal row.
- Gemini has one key, `GOOGLE_GENERATIVE_AI_API_KEY`, for chat models and
  for voice input, embeddings, and image generation. Read it with
  `resolveGeminiApiKey()` from `@agent-native/core/server` (never
  `resolveSecret("GEMINI_API_KEY")`): rows saved under the older
  `GEMINI_API_KEY` name still answer, and removing the key removes both
  names at its own scope. An older-name row at another scope (Brain once
  saved one for the whole workspace) still answers and is listed with the
  ad-hoc keys; remove it with
  `DELETE /_agent-native/secrets/adhoc/GEMINI_API_KEY?scope=workspace`
  (owners and admins). Don't register `GEMINI_API_KEY`; record an app's uses with
  `registerSecretUsage(GEMINI_API_KEY, [...])` from `@agent-native/core/secrets`.

### Restrict personal API keys

An org setting that stops members (not owners or admins) from using or adding
their own model provider keys and personal Builder.io connection. Read and
change it with the `manage-provider-key-policy` action: omit `set` to read it
(owners and admins also get `affectedMembers`, each member and the providers
that stop), `set: true|false` to change it (owners and admins only, audited).
Read it before turning it on and tell the user who is affected.

- Nothing is deleted. Restricted rows stay stored and work again when it is
  turned off.
- Scope is the provider keys, their endpoints, and the Builder key pair
  (`isPersonalProviderPolicyKey` in `server/personal-provider-key-policy.ts`).
  Other personal secrets are untouched.
- Every resolver asks `isPersonalProviderKeyUseRestricted`: it skips the
  member's `user` row, their `solo:<email>` row, and legacy personal settings
  rows, then continues to the org's. An unreadable policy is a failed lookup,
  never "not restricted". Add any new resolver or personal write path here.
- Personal saves (provider-key route, secrets routes, scoped key saves,
  personal Builder.io connect) refuse with "Owners and admins restricted
  personal API keys." Removing a personal key stays allowed. A chat with no
  usable key answers with the same message (`personal_provider_keys_restricted`).

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

Vault keys land in the shared `app_secrets` store at `org` scope, so an app's
Settings → API keys tab reports them as `Set · Vault` through
`resolveSecretDetailed` (`source`/`scopeId`) instead of the registered-scope
row alone. Runtime precedence is personal (`user`) row → shared `org` row →
legacy `workspace` row → designated vault org → deploy env. Never add a second
place to enter a key that the Vault already provides; label the source instead.

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
