import { defineAction } from "@agent-native/core";
import {
  getWorkspaceConnection,
  revokeWorkspaceConnectionGrant,
  upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant,
} from "@agent-native/core/workspace-connections";
import { z } from "zod";

const httpBoolean = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

const DEFAULT_KNOWN_APP_IDS = [
  "dispatch",
  "brain",
  "assets",
  "analytics",
  "mail",
];

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

export default defineAction({
  description:
    "Grant or revoke one workspace app's access to a shared workspace integration connection.",
  schema: z.object({
    connectionId: z.string().describe("Workspace connection ID."),
    appId: z
      .string()
      .optional()
      .describe("App ID to grant or revoke, e.g. brain or analytics."),
    granted: httpBoolean
      .default(true)
      .describe("True to grant access, false to revoke access."),
    accessMode: z
      .enum(["all-apps", "selected-apps"])
      .optional()
      .describe(
        "Set all-app access explicitly, or manage selected app grants.",
      ),
    knownAppIds: z
      .array(z.string())
      .default([])
      .describe(
        "Known workspace app IDs. Used when converting an all-app connection into selected-app grants.",
      ),
  }),
  run: async (args) => {
    const connection = await getWorkspaceConnection(args.connectionId);
    if (!connection) {
      throw new Error(`Workspace connection "${args.connectionId}" not found.`);
    }

    let allowedApps = connection.allowedApps;
    if (args.accessMode === "all-apps") {
      allowedApps = [];
    } else {
      if (!args.appId?.trim()) {
        throw new Error("set-workspace-connection-grant requires appId.");
      }
      const appId = args.appId.trim();
      const knownAppIds = uniqueStrings([
        ...DEFAULT_KNOWN_APP_IDS,
        ...args.knownAppIds,
        ...connection.allowedApps,
        appId,
      ]);

      if (connection.allowedApps.length === 0 && !args.granted) {
        allowedApps = knownAppIds.filter((id) => id !== appId);
      } else if (connection.allowedApps.length > 0 && !args.granted) {
        allowedApps = connection.allowedApps.filter((id) => id !== appId);
        await revokeWorkspaceConnectionGrant(connection.id, appId);
      } else if (connection.allowedApps.length > 0 && args.granted) {
        allowedApps = connection.allowedApps;
        await upsertWorkspaceConnectionGrant({
          connectionId: connection.id,
          appId,
        });
      }
    }

    return upsertWorkspaceConnection({
      id: connection.id,
      provider: connection.provider,
      label: connection.label,
      accountId: connection.accountId,
      accountLabel: connection.accountLabel,
      status: connection.status,
      scopes: connection.scopes,
      config: connection.config,
      allowedApps,
      credentialRefs: connection.credentialRefs,
      lastCheckedAt: connection.lastCheckedAt,
      lastError: connection.lastError,
    });
  },
});
