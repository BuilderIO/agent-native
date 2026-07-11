import { defineAction } from "@agent-native/core";
import { getDbExec } from "@agent-native/core/db";
import {
  upsertCustomProvider,
  deleteCustomProvider,
  listCustomProviders,
  getCustomProvider,
  assertCanMutateCustomProviderScope,
} from "@agent-native/core/provider-api";
import { getCredentialContext } from "@agent-native/core/server";
import { z } from "zod";

/**
 * Resolve the caller's role in a specific org, straight from `org_members`.
 *
 * `getCredentialContext()` (from `@agent-native/core/server`) only exposes
 * `{ userEmail, orgId }` — no role. `getOrgContext()` (from
 * `@agent-native/core/org`) resolves role but requires an `H3Event`, which
 * `defineAction` handlers are not given. This mirrors the established
 * no-event role-lookup idiom already used for org-admin gating inside
 * agent-callable/background code (see `isCurrentUserOrgAdmin` in
 * `packages/core/src/jobs/tools.ts`, `getViewerOrgRole` in
 * `packages/dispatch/src/server/lib/usage-metrics-store.ts`, and the same
 * query in `packages/core/src/mcp/actions/service-token-access.ts`) — same
 * SQL, same fail-closed-to-null-on-error semantics. Returns null (never an
 * org role) on any lookup error or when the caller has no membership row in
 * this org.
 */
async function resolveCallerOrgRole(
  orgId: string | null,
  email: string,
): Promise<string | null> {
  if (!orgId) return null;
  try {
    const client = getDbExec();
    const { rows } = await client.execute({
      sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [orgId, email.toLowerCase()],
    });
    if (rows.length === 0) return null;
    const role = (rows[0] as { role?: unknown }).role;
    return typeof role === "string" && role ? role : null;
  } catch {
    return null;
  }
}

const AuthSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("none"),
  }),
  z.object({
    type: z.literal("bearer"),
    credentialKey: z
      .string()
      .min(1)
      .describe(
        "Name of the credential key (e.g. MY_API_TOKEN). Must already be saved via app secrets — this action never accepts secret values.",
      ),
  }),
  z.object({
    type: z.literal("basic"),
    usernameKey: z
      .string()
      .min(1)
      .describe("Credential key name for the username/login."),
    passwordKey: z
      .string()
      .min(1)
      .describe("Credential key name for the password/secret."),
  }),
  z.object({
    type: z.literal("api-key-header"),
    credentialKey: z
      .string()
      .min(1)
      .describe("Credential key name for the API key value."),
    headerName: z
      .string()
      .min(1)
      .describe("HTTP header name to send the key in (e.g. X-Api-Key)."),
  }),
]);

export default defineAction({
  description: `Register or update a custom API provider so the agent can call it via provider-api-request and look up its docs via provider-api-docs.

IMPORTANT — credentials:
- This action stores only credential KEY NAMES, never secret values.
- If the required API key is not yet saved, instruct the user to add it via app Settings → Keys, or use the create-vault-secret action, before calling this action.
- Supported auth kinds: none, bearer, basic, api-key-header.
  google-service-account and oauth-bearer are NOT supported for custom providers.

After registration the provider appears in provider-api-catalog and can be used with provider-api-request.`,
  schema: z.object({
    operation: z
      .enum(["upsert", "delete", "list", "get"])
      .default("upsert")
      .describe(
        "Operation: upsert (create or update), delete (remove), list (all custom providers), get (single provider).",
      ),
    id: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe(
        "Provider slug (e.g. my-api). Lowercase letters, digits, hyphens only. Required for upsert/delete/get.",
      ),
    label: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Human-readable name (e.g. 'My Analytics API'). Required for upsert.",
      ),
    baseUrl: z
      .string()
      .url()
      .optional()
      .describe(
        "Base URL for the API (e.g. https://api.example.com/v1). Required for upsert. Must be a public https/http URL.",
      ),
    auth: AuthSchema.optional().describe(
      "Auth configuration. Required for upsert. Use type 'none' for public APIs.",
    ),
    docsUrls: z
      .array(z.string().url())
      .optional()
      .describe("Optional list of documentation URLs for this provider."),
    allowedHostSuffixes: z
      .array(z.string())
      .optional()
      .describe(
        "Optional list of additional host suffixes requests may target beyond the base URL origin (e.g. ['example.com']).",
      ),
    defaultHeaders: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        "Optional headers to include on every request (e.g. { 'Accept': 'application/json' }).",
      ),
    notes: z
      .string()
      .max(1000)
      .optional()
      .describe("Optional notes about this provider shown in the catalog."),
    scope: z
      .enum(["user", "org"])
      .default("org")
      .describe(
        "Whether to store the provider for the current user only ('user') or for the whole workspace ('org').",
      ),
  }),
  http: false,
  run: async ({
    operation,
    id,
    label,
    baseUrl,
    auth,
    docsUrls,
    allowedHostSuffixes,
    defaultHeaders,
    notes,
    scope,
  }) => {
    const ctx = getCredentialContext();
    if (!ctx) {
      throw new Error(
        "provider-api-register requires an authenticated request context.",
      );
    }
    const scopeId =
      scope === "org" ? (ctx.orgId ?? ctx.userEmail) : ctx.userEmail;

    // Only upsert/delete mutate state; list/get remain readable by any org
    // member (scoping org-scoped reads is left as a follow-up — see plan
    // 014). Resolve the caller's role in the *target* org (`scopeId`, which
    // for scope === "org" is exactly `ctx.orgId`) and enforce owner/admin
    // before allowing an org-scoped write. `assertCanMutateCustomProviderScope`
    // is the single source of truth for this check and is also enforced a
    // second time inside `upsertCustomProvider`/`deleteCustomProvider`
    // themselves (defense in depth) — calling it here too gives a clear,
    // early error before any other work happens.
    //
    // When the caller has no active org (`ctx.orgId` is null — a solo user,
    // or an app that hasn't wired `resolveOrgId` at all), `scopeId` above
    // already collapsed to `ctx.userEmail`: there is no shared org resource
    // to protect, and no *other* caller can ever address that same scopeId
    // (every other request's fallback is scoped to *its own* email). Treat
    // that case like sole ownership of a personal bucket — consistent with
    // `org/context.ts`'s auto-created personal org, which also assigns the
    // user role "owner" — rather than hard-rejecting scope: "org" (the
    // action's own default) for every solo user or org-less app.
    let orgRole: string | null = null;
    if ((operation === "upsert" || operation === "delete") && scope === "org") {
      orgRole = ctx.orgId
        ? await resolveCallerOrgRole(ctx.orgId, ctx.userEmail)
        : "owner";
      assertCanMutateCustomProviderScope(scope, scopeId, orgRole);
    }

    if (operation === "list") {
      const providers = await listCustomProviders(scope, scopeId);
      return {
        providers: providers.map((p) => ({
          id: p.id,
          label: p.label,
          baseUrl: p.baseUrl,
          authType: p.auth.type,
          docsUrls: p.docsUrls,
          notes: p.notes,
          updatedAt: p.updatedAt,
        })),
        count: providers.length,
      };
    }

    if (operation === "get") {
      if (!id) throw new Error("id is required for get operation.");
      const provider = await getCustomProvider(scope, scopeId, id);
      if (!provider) {
        return { found: false, id };
      }
      return { found: true, provider };
    }

    if (operation === "delete") {
      if (!id) throw new Error("id is required for delete operation.");
      const deleted = await deleteCustomProvider(scope, scopeId, id, orgRole);
      return { deleted, id };
    }

    // upsert
    if (!id) throw new Error("id is required for upsert operation.");
    if (!label) throw new Error("label is required for upsert operation.");
    if (!baseUrl) throw new Error("baseUrl is required for upsert operation.");
    if (!auth) throw new Error("auth is required for upsert operation.");

    await upsertCustomProvider({
      scope,
      scopeId,
      id,
      label,
      baseUrl,
      auth,
      docsUrls,
      allowedHostSuffixes,
      defaultHeaders,
      notes,
      orgRole,
    });

    return {
      registered: true,
      id,
      label,
      message: `Custom provider "${id}" registered. Use provider-api-catalog to inspect it and provider-api-request to call it.`,
    };
  },
});
