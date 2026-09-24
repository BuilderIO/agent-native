import { z, type ZodTypeAny } from "zod";

import { defineAction } from "../../action.js";
import { getCredentialContext } from "../../server/request-context.js";
import {
  assertCanMutateCustomProviderScope,
  deleteCustomProvider,
  getCustomProvider,
  listCustomProviders,
  upsertCustomProvider,
} from "../index.js";

const AuthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("bearer"),
    credentialKey: z
      .string()
      .min(1)
      .describe(
        "Name of the credential key. The secret value must already be stored; this action never accepts secret values.",
      ),
  }),
  z.object({
    type: z.literal("basic"),
    usernameKey: z.string().min(1).describe("Credential key for the username."),
    passwordKey: z.string().min(1).describe("Credential key for the password."),
  }),
  z.object({
    type: z.literal("api-key-header"),
    credentialKey: z
      .string()
      .min(1)
      .describe("Credential key for the API key."),
    headerName: z.string().min(1).describe("HTTP header name for the API key."),
  }),
]);

export const CustomProviderRegistrationSchema = z.object({
  operation: z
    .enum(["upsert", "delete", "list", "get"])
    .default("upsert")
    .describe("Operation to perform."),
  id: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe("Provider slug. Required for upsert, delete, and get."),
  label: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Human-readable provider name. Required for upsert."),
  baseUrl: z
    .string()
    .url()
    .optional()
    .describe("Public HTTP(S) API base URL. Required for upsert."),
  auth: AuthSchema.optional().describe("Authentication configuration."),
  docsUrls: z
    .array(z.string().url())
    .optional()
    .describe("Optional provider documentation URLs."),
  allowedHostSuffixes: z
    .array(z.string())
    .optional()
    .describe("Optional additional allowed host suffixes."),
  defaultHeaders: z
    .record(z.string(), z.string())
    .optional()
    .describe("Optional non-secret headers included with every request."),
  notes: z
    .string()
    .max(1000)
    .optional()
    .describe("Optional notes shown in the provider catalog."),
  scope: z
    .enum(["user", "org"])
    .default("org")
    .describe("Store for the current user or the current organization."),
});

type RegistrationArgs = z.output<typeof CustomProviderRegistrationSchema>;

export interface CustomProviderRegistrationContext {
  userEmail: string;
  orgId: string | null;
}

export interface CreateCustomProviderRegistrationActionOptions<
  TSchema extends ZodTypeAny = typeof CustomProviderRegistrationSchema,
> {
  schema?: TSchema;
  description?: string;
  getContext?: () => CustomProviderRegistrationContext | null;
  resolveOrgRole?: (orgId: string, userEmail: string) => Promise<string | null>;
}

export function createCustomProviderRegistrationAction<
  TSchema extends ZodTypeAny = typeof CustomProviderRegistrationSchema,
>(options: CreateCustomProviderRegistrationActionOptions<TSchema> = {}) {
  const schema = options.schema ?? CustomProviderRegistrationSchema;
  return defineAction({
    description:
      options.description ??
      "Register, inspect, or delete a custom API provider for provider-api-request. This stores credential key names only, never secret values. Save required credentials through the app's secrets surface before registration.",
    schema,
    http: false,
    run: async (rawArgs) => {
      const args = rawArgs as RegistrationArgs;
      const ctx = options.getContext?.() ?? getCredentialContext();
      if (!ctx) {
        throw new Error(
          "provider-api-register requires an authenticated request context.",
        );
      }
      const scopeId =
        args.scope === "org" ? (ctx.orgId ?? ctx.userEmail) : ctx.userEmail;

      let orgRole: string | null = null;
      if (
        (args.operation === "upsert" || args.operation === "delete") &&
        args.scope === "org"
      ) {
        orgRole = ctx.orgId
          ? ((await options.resolveOrgRole?.(ctx.orgId, ctx.userEmail)) ?? null)
          : "owner";
        assertCanMutateCustomProviderScope(args.scope, scopeId, orgRole);
      }

      if (args.operation === "list") {
        const providers = await listCustomProviders(args.scope, scopeId);
        return {
          providers: providers.map((provider) => ({
            id: provider.id,
            label: provider.label,
            baseUrl: provider.baseUrl,
            authType: provider.auth.type,
            docsUrls: provider.docsUrls,
            notes: provider.notes,
            updatedAt: provider.updatedAt,
          })),
          count: providers.length,
        };
      }

      if (args.operation === "get") {
        if (!args.id) throw new Error("id is required for get operation.");
        const provider = await getCustomProvider(args.scope, scopeId, args.id);
        return provider
          ? { found: true, provider }
          : { found: false, id: args.id };
      }

      if (args.operation === "delete") {
        if (!args.id) throw new Error("id is required for delete operation.");
        const deleted = await deleteCustomProvider(
          args.scope,
          scopeId,
          args.id,
          orgRole,
        );
        return { deleted, id: args.id };
      }

      if (!args.id) throw new Error("id is required for upsert operation.");
      if (!args.label)
        throw new Error("label is required for upsert operation.");
      if (!args.baseUrl)
        throw new Error("baseUrl is required for upsert operation.");
      if (!args.auth) throw new Error("auth is required for upsert operation.");

      await upsertCustomProvider({
        scope: args.scope,
        scopeId,
        id: args.id,
        label: args.label,
        baseUrl: args.baseUrl,
        auth: args.auth,
        docsUrls: args.docsUrls,
        allowedHostSuffixes: args.allowedHostSuffixes,
        defaultHeaders: args.defaultHeaders,
        notes: args.notes,
        orgRole,
      });

      return {
        registered: true,
        id: args.id,
        label: args.label,
        message: `Custom provider "${args.id}" registered. Use provider-api-catalog to inspect it and provider-api-request to call it.`,
      };
    },
  });
}
