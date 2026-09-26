import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { deleteApiKey } from "../api-keys.js";

export default defineAction({
  description:
    'Delete one saved key listed by list-api-keys. Pass its name, scope, and storedScope. Deleting an organization key (scope "org") needs an owner or admin and affects everyone in the organization. A model provider key also removes its endpoint and older key names at the same row. Keys managed by another Settings page (managedBy) and keys synced from the Dispatch Vault are refused; they are removed where they are managed. Before deleting, call preview-secret-removal with the same name and storedScope, tell the user what stops working, and get their confirmation.',
  schema: z.object({
    name: z
      .string()
      .min(1)
      .describe(
        'Stored key name from list-api-keys, e.g. "STRIPE_SECRET_KEY".',
      ),
    scope: z
      .enum(["user", "org"])
      .describe(
        "The key's scope from list-api-keys: the caller's own or the organization's.",
      ),
    storedScope: z
      .enum(["user", "workspace", "org"])
      .optional()
      .describe("The key's storedScope from list-api-keys. Defaults to scope."),
  }),
  http: { method: "POST" },
  audit: {
    target: (args, _result, meta) => ({
      type: "api-key",
      id: args.name,
      ...(args.scope === "org"
        ? { orgId: meta.orgId ?? null, visibility: "admins" as const }
        : { visibility: "private" as const }),
    }),
    summary: (args) =>
      args.scope === "org"
        ? `Deleted organization key ${args.name}`
        : `Deleted personal key ${args.name}`,
  },
  run: async (args, ctx) => {
    const email = ctx?.userEmail?.trim().toLowerCase();
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    const orgId = ctx?.orgId?.trim() || null;
    if (args.scope === "org" && !orgId) {
      fail("Select an organization to delete its keys.", { statusCode: 400 });
    }
    const result = await deleteApiKey(
      { email, orgId },
      {
        name: args.name,
        scope: args.scope,
        ...(args.storedScope ? { storedScope: args.storedScope } : {}),
      },
    );
    switch (result.status) {
      case "deleted":
        return { ok: true as const, removed: result.removed };
      case "forbidden":
        fail(result.error, { statusCode: 403 });
      case "managed":
        fail(
          `"${args.name}" is managed by ${result.managedBy.owner}. Remove it there.`,
          { statusCode: 409, errorCode: "secret_managed_elsewhere" },
        );
      case "vault":
        fail(
          `"${args.name}" is synced from the Dispatch Vault. Remove it there.`,
          { statusCode: 409, errorCode: "secret_managed_in_vault" },
        );
      case "not-found":
        fail(`No saved key named "${args.name}" at that scope.`, {
          statusCode: 404,
        });
    }
  },
});
