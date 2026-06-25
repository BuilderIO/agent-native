import { defineAction } from "@agent-native/core";
import {
  upsertCustomProvider,
  deleteCustomProvider,
  listCustomProviders,
  getCustomProvider,
} from "@agent-native/core/provider-api";
import { getCredentialContext } from "@agent-native/core/server";
import { z } from "zod";

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
      const deleted = await deleteCustomProvider(scope, scopeId, id);
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
    });

    return {
      registered: true,
      id,
      label,
      message: `Custom provider "${id}" registered. Use provider-api-catalog to inspect it and provider-api-request to call it.`,
    };
  },
});
