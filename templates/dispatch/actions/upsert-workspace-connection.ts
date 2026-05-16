import { defineAction } from "@agent-native/core";
import {
  getWorkspaceConnectionProvider,
  type WorkspaceConnectionProvider,
} from "@agent-native/core/connections";
import {
  upsertWorkspaceConnection,
  type WorkspaceConnectionStatus,
} from "@agent-native/core/workspace-connections";
import { z } from "zod";

const statusSchema = z.enum([
  "connected",
  "checking",
  "needs_reauth",
  "error",
  "disabled",
]);

const credentialRefSchema = z
  .object({
    key: z.string().describe("Vault or OAuth credential reference name."),
    scope: z
      .enum(["user", "org", "workspace"])
      .optional()
      .describe("Reference scope. Defaults to org."),
    provider: z.string().optional(),
    label: z.string().optional(),
  })
  .strict();

function normalizeCredentialRefs(
  refs: Array<z.infer<typeof credentialRefSchema>>,
  provider: WorkspaceConnectionProvider,
) {
  const credentialLabels = new Map(
    provider.credentialKeys.map((credential) => [
      credential.key,
      credential.label,
    ]),
  );
  const seen = new Set<string>();
  return refs
    .map((ref) => ({
      key: ref.key.trim(),
      scope: ref.scope ?? "org",
      provider: ref.provider?.trim() || provider.id,
      label:
        ref.label?.trim() ||
        credentialLabels.get(ref.key.trim()) ||
        ref.key.trim(),
    }))
    .filter((ref) => {
      if (!ref.key || seen.has(ref.key)) return false;
      seen.add(ref.key);
      return true;
    });
}

export default defineAction({
  description:
    "Create or update a shared workspace integration connection and its app access list.",
  schema: z.object({
    id: z.string().optional().describe("Existing connection ID to update."),
    provider: z
      .string()
      .describe("Provider ID from the workspace connection provider catalog."),
    label: z.string().optional().describe("Human label for the connection."),
    accountId: z
      .string()
      .nullable()
      .optional()
      .describe("Provider account/workspace ID, when known."),
    accountLabel: z
      .string()
      .nullable()
      .optional()
      .describe("Provider account/workspace display name, when known."),
    status: statusSchema.default("connected"),
    scopes: z
      .array(z.string())
      .default([])
      .describe("Provider scopes granted to this connection."),
    config: z
      .record(z.string(), z.unknown())
      .default({})
      .describe(
        "Non-secret provider metadata. Secret-looking fields are redacted.",
      ),
    allowedApps: z
      .array(z.string())
      .default([])
      .describe("App IDs that may use this connection. Empty means all apps."),
    credentialRefs: z
      .array(credentialRefSchema)
      .default([])
      .describe(
        "References to vault/OAuth credentials, never raw secret values.",
      ),
    lastError: z.string().nullable().optional(),
  }),
  run: async (args) => {
    const provider = getWorkspaceConnectionProvider(args.provider);
    if (!provider) {
      throw new Error(
        `Unknown workspace connection provider "${args.provider}". Use list-workspace-connections to see valid provider IDs.`,
      );
    }

    return upsertWorkspaceConnection({
      ...args,
      status: args.status as WorkspaceConnectionStatus,
      credentialRefs: normalizeCredentialRefs(args.credentialRefs, provider),
    });
  },
});
