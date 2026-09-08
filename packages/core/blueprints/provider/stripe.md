# Blueprint: integrate the Stripe API

You are a coding agent working inside an **agent-native** app (a repo built on
`@agent-native/core`). Apply this blueprint as real source changes on the
current branch. Do not just describe the work — do it, then verify.

## Goal

Let the agent (and the UI) talk to the Stripe API for ad-hoc reads — list
charges, look up a customer, summarize subscriptions — **without minting one
rigid action per endpoint**. Wire Stripe into the shared **provider-api
substrate** so any endpoint/filter is reachable through a single, safe surface.

## Why the provider-api substrate (read this first)

The framework tenet (see `CLAUDE.md` → Architecture Contract and the `actions`
skill): first-class actions are ergonomic shortcuts, **not** capability limits.
Do not hardcode `list-stripe-charges`, `get-stripe-customer`,
`list-stripe-subscriptions`, … Instead expose the provider-api trio so the agent
can hit any Stripe endpoint with the user's configured credentials, behind host
allow-listing, credential injection, private-network blocking, and secret
redaction.

The substrate lives in `@agent-native/core/provider-api`:

- `provider-api-catalog` — lists provider base URLs, auth style, credential
  keys, docs/spec URLs, placeholders, and examples (never secrets).
- `provider-api-docs` — fetches the registered public docs/spec URLs when the
  exact endpoint, filter, or payload is uncertain.
- `provider-api-request` — makes one constrained authenticated request to the
  provider host, injects the configured credential, blocks internal URLs, and
  redacts secrets.

## Files to touch

1. **Register the Stripe provider config** wherever this app assembles its
   provider catalog (grep for `providerApi`, `provider-api`, or `defineProvider`
   under `actions/`, `server/`, or look at `templates/dispatch/actions/` for the
   canonical wiring). Add an entry like:

   ```ts
   {
     id: "stripe",
     label: "Stripe",
     baseUrl: "https://api.stripe.com",
     auth: { type: "bearer", credentialKey: "STRIPE_SECRET_KEY" },
     docsUrls: ["https://docs.stripe.com/api"],
     // Obviously-fake placeholder only — never a real key.
     placeholders: { STRIPE_SECRET_KEY: "sk_test_PLACEHOLDER_xxx" },
     examples: [
       "GET /v1/charges?limit=10",
       "GET /v1/customers/{id}",
       "GET /v1/subscriptions?status=active",
     ],
   }
   ```

2. **Expose the three provider-api actions** if the app does not already export
   them. Re-use `@agent-native/core/provider-api`; do **not** re-implement the
   request/redaction logic. Keep `provider-api-request` `http: false` unless this
   app has a separate UI permission model for arbitrary provider writes.

3. **Register the credential** so it shows in the agent settings/onboarding UI.
   Read the `secrets` and `onboarding` skills. The Stripe secret key is read at
   request time via `readAppSecret` / the provider credential adapter — never
   `process.env` for per-user/org secrets, never a literal in source.

## Framework rules to honor

- No `/api/*` or Nitro pass-through routes that just call Stripe — that violates
  the Architecture Contract. The provider-api actions are already callable from
  the agent, the UI (`useActionMutation`), HTTP, and MCP.
- Never hardcode the Stripe key, a webhook signing secret, or any
  credential-looking literal in source, tests, fixtures, or docs. Use
  `sk_test_PLACEHOLDER_xxx`-style fakes.
- If you add a publishable-package source change, add a `.changeset/*.md`.
- Keep the action surface small and orthogonal — the trio replaces a dozen
  per-endpoint actions.

## Verify

1. `agent-native typecheck` (or `tsc --noEmit`) passes.
2. With a placeholder `STRIPE_SECRET_KEY` set, ask the agent: "list my 5 most
   recent Stripe charges." Confirm it calls `provider-api-catalog` →
   (optionally) `provider-api-docs` → `provider-api-request` against
   `api.stripe.com`, and that the response redacts secrets.
3. Confirm the Stripe credential appears in the settings/onboarding checklist.
