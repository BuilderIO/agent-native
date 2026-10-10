import { isDeepStrictEqual } from "node:util";

import { defineAction, fail } from "@agent-native/core/action";
import {
  ACTION_CHAT_UI_RECORD_CHANGE_RENDERER,
  normalizeActionChangeResult,
} from "@agent-native/core/action-ui";
import {
  getWorkspaceConnectionProvider,
  type WorkspaceConnectionProvider,
} from "@agent-native/core/connections";
import { isOrgMember } from "@agent-native/core/org";
import { track } from "@agent-native/core/tracking";
import {
  assertWorkspaceUserGroupIds,
  getWorkspaceConnection,
  normalizeWorkspaceConnectionAllowedUsers,
  upsertWorkspaceConnection,
  type WorkspaceConnectionStatus,
} from "@agent-native/core/workspace-connections";
import { z } from "zod";

import { assertWorkspaceConnectionManager } from "./connection-permissions.js";

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

function connectionChanged(
  before: Awaited<ReturnType<typeof getWorkspaceConnection>>,
  after: NonNullable<Awaited<ReturnType<typeof getWorkspaceConnection>>>,
): boolean {
  if (!before) return true;
  return (
    before.provider !== after.provider ||
    before.label !== after.label ||
    before.accountId !== after.accountId ||
    before.accountLabel !== after.accountLabel ||
    before.status !== after.status ||
    !isDeepStrictEqual(before.scopes, after.scopes) ||
    !isDeepStrictEqual(before.config, after.config) ||
    !isDeepStrictEqual(before.allowedApps, after.allowedApps) ||
    !isDeepStrictEqual(before.allowedUsers, after.allowedUsers) ||
    !isDeepStrictEqual(before.allowedUserGroups, after.allowedUserGroups) ||
    !isDeepStrictEqual(before.credentialRefs, after.credentialRefs) ||
    before.lastCheckedAt !== after.lastCheckedAt ||
    before.lastError !== after.lastError
  );
}

function connectionChange(
  verb: "created" | "updated",
  connection: NonNullable<Awaited<ReturnType<typeof getWorkspaceConnection>>>,
) {
  return {
    change: {
      verb,
      kind: "workspace-connection",
      title: connection.label.slice(0, 180),
      ...(connection.accountLabel
        ? { detail: connection.accountLabel.slice(0, 500) }
        : {}),
      url: "/settings/integrations",
    },
  };
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
  chatUI: {
    renderer: ACTION_CHAT_UI_RECORD_CHANGE_RENDERER,
    when: (_args, result) => normalizeActionChangeResult(result) !== null,
    projectResult: (_args, result) => normalizeActionChangeResult(result),
  },
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
      .optional()
      .describe(
        "Non-secret provider configuration and metadata. Secret-looking fields are redacted. Follow configurationFields from the provider catalog.",
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
    await assertWorkspaceConnectionManager(ctx, args.allowedApps);
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
    const allowedUserGroups = await assertWorkspaceConnectionAllowedUserGroups(
      args.allowedUserGroups,
      ctx?.orgId,
    );

    const before = args.id?.trim()
      ? await getWorkspaceConnection(args.id.trim())
      : null;
    const configurationFields = provider.configurationFields ?? [];
    const allowedConfigurationKeys = new Set(
      configurationFields.map(({ key }) => key),
    );
    const suppliedConfig = args.config ?? {};
    if (
      configurationFields.length > 0 &&
      Object.keys(suppliedConfig).some(
        (key) => !allowedConfigurationKeys.has(key),
      )
    ) {
      fail(
        `Configuration fields for ${provider.label} must match its provider catalog.`,
        {
          errorCode: "workspace_connection_config_unknown_field",
          statusCode: 400,
        },
      );
    }
    const config = {
      ...Object.fromEntries(
        configurationFields
          .filter((field) => field.defaultValue !== undefined)
          .map((field) => [field.key, field.defaultValue]),
      ),
      ...(before?.provider === provider.id ? before.config : {}),
      ...suppliedConfig,
    };
    for (const field of configurationFields) {
      const value = config[field.key];
      if (value !== undefined && typeof value !== "string") {
        fail(`Configuration field ${field.key} must be text.`, {
          errorCode: "workspace_connection_config_invalid",
          statusCode: 400,
        });
      }
      if (field.required && (typeof value !== "string" || !value.trim())) {
        fail(`Required configuration field is missing: ${field.key}.`, {
          errorCode: "workspace_connection_config_missing",
          statusCode: 400,
        });
      }
    }
    const result = await upsertWorkspaceConnection({
      ...args,
      config,
      status: args.status as WorkspaceConnectionStatus,
      allowedUsers,
      allowedUserGroups,
      credentialRefs: normalizeCredentialRefs(args.credentialRefs, provider),
    });
    const channel = args.provider.trim().toLowerCase();
    if (channel === "slack" || channel === "telegram") {
      track(
        "messenger_connected",
        {
          app_name: "dispatch",
          template_name: "dispatch",
          channel,
          connection_id: result.id,
        },
        ctx,
      );
    }
    if (!connectionChanged(before, result)) return result;
    return {
      ...result,
      ...connectionChange(before ? "updated" : "created", result),
    };
  },
});
