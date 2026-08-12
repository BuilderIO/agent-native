import { defineAction } from "@agent-native/core";
import {
  getWorkspaceConnectionProvider,
  type WorkspaceConnectionProvider,
} from "@agent-native/core/connections";
import { isOrgMember } from "@agent-native/core/org";
import {
  assertWorkspaceUserGroupIds,
  normalizeWorkspaceConnectionAllowedUsers,
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

export async function assertWorkspaceConnectionAllowedUsers(
  allowedUsers: string[] | undefined,
  orgId: string | null | undefined,
): Promise<string[] | undefined> {
  if (allowedUsers === undefined) return undefined;

  const normalized = normalizeWorkspaceConnectionAllowedUsers(allowedUsers);
  if (normalized.length === 0) return normalized;
  if (!orgId?.trim()) {
    throw new Error(
      "Selected people require a workspace connection. Personal connections are only available to you.",
    );
  }

  const missing = (
    await Promise.all(
      normalized.map(async (email) =>
        (await isOrgMember(orgId, email)) ? null : email,
      ),
    )
  ).filter((email): email is string => Boolean(email));
  if (missing.length > 0) {
    throw new Error(
      `Selected people must be members of this workspace: ${missing.join(", ")}.`,
    );
  }
  return normalized;
}

export async function assertWorkspaceConnectionAllowedUserGroups(
  allowedUserGroups: string[] | undefined,
  orgId: string | null | undefined,
): Promise<string[] | undefined> {
  return assertWorkspaceUserGroupIds(allowedUserGroups, orgId);
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
    allowedUsers: z
      .array(z.string())
      .optional()
      .describe(
        "Workspace member email addresses that may use this connection. Empty means all workspace members.",
      ),
    allowedUserGroups: z
      .array(z.string())
      .optional()
      .describe(
        "Workspace user group IDs that may use this connection. Groups are unioned with selected people.",
      ),
    credentialRefs: z
      .array(credentialRefSchema)
      .default([])
      .describe(
        "References to vault/OAuth credentials, never raw secret values.",
      ),
    lastError: z.string().nullable().optional(),
  }),
  run: async (args, ctx) => {
    const provider = getWorkspaceConnectionProvider(args.provider);
    if (!provider) {
      throw new Error(
        `Unknown workspace connection provider "${args.provider}". Use list-workspace-connections to see valid provider IDs.`,
      );
    }

    const allowedUsers = await assertWorkspaceConnectionAllowedUsers(
      args.allowedUsers,
      ctx?.orgId,
    );
    const allowedUserGroups =
      await assertWorkspaceConnectionAllowedUserGroups(
        args.allowedUserGroups,
        ctx?.orgId,
      );

    return upsertWorkspaceConnection({
      ...args,
      status: args.status as WorkspaceConnectionStatus,
      allowedUsers,
      allowedUserGroups,
      credentialRefs: normalizeCredentialRefs(args.credentialRefs, provider),
    });
  },
});
