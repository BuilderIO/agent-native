import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolveLocalhostConnectionScope } from "../server/lib/localhost-connection.js";
import { designConnectionIdsFromData } from "../shared/source-mode.js";

export default defineAction({
  description:
    "Refresh the read-only preview token for a localhost Design screen after the local bridge restarts.",
  schema: z.object({
    designId: z.string().describe("Design project ID."),
    connectionId: z
      .string()
      .optional()
      .describe(
        "Localhost connection ID. Omit to refresh all design connections.",
      ),
    publicVisualEdit: z
      .boolean()
      .optional()
      .describe(
        "Allow the public /visual-edit surface to use the connection's read-only preview credential.",
      ),
  }),
  readOnly: true,
  requiresAuth: false,
  http: { method: "GET" },
  capabilityScopes: ["visual-edit"],
  run: async ({ designId, connectionId, publicVisualEdit }) => {
    const access = await assertAccess("design", designId, "viewer");
    const designData = (access.resource as { data?: unknown }).data;
    const designConnectionIds = designConnectionIdsFromData(designData);
    if (
      publicVisualEdit === true &&
      (access.resource as { visibility?: unknown }).visibility !== "public"
    ) {
      const error = new Error(
        `Design "${designId}" is not public for visual editing.`,
      ) as Error & { statusCode: number };
      error.statusCode = 403;
      throw error;
    }
    if (publicVisualEdit === true && designConnectionIds.length === 0) {
      const error = new Error(
        `Design "${designId}" does not reference a localhost connection.`,
      ) as Error & { statusCode: number };
      error.statusCode = 403;
      throw error;
    }
    const requestedConnectionIds = connectionId
      ? [connectionId]
      : designConnectionIds;
    if (requestedConnectionIds.length === 0) {
      const error = new Error(
        `Design "${designId}" has no localhost connections.`,
      ) as Error & { statusCode: number };
      error.statusCode = 403;
      throw error;
    }
    if (connectionId && !designConnectionIds.includes(connectionId)) {
      const error = new Error(
        `Localhost connection "${connectionId}" is not part of design "${designId}".`,
      ) as Error & { statusCode: number };
      error.statusCode = 403;
      throw error;
    }
    const { ownerEmail, orgId } = await resolveLocalhostConnectionScope({
      designId,
      allowPublicViewer: publicVisualEdit === true,
    });
    const connections = await getDb()
      .select({
        id: schema.designLocalhostConnections.id,
        previewToken: schema.designLocalhostConnections.previewToken,
        bridgeUrl: schema.designLocalhostConnections.bridgeUrl,
      })
      .from(schema.designLocalhostConnections)
      .where(
        and(
          inArray(schema.designLocalhostConnections.id, requestedConnectionIds),
          eq(schema.designLocalhostConnections.ownerEmail, ownerEmail),
          orgId
            ? eq(schema.designLocalhostConnections.orgId, orgId)
            : isNull(schema.designLocalhostConnections.orgId),
        ),
      )
      .limit(requestedConnectionIds.length);

    const connectionById = new Map(
      connections.map((connection) => [connection.id, connection]),
    );
    for (const requestedId of requestedConnectionIds) {
      if (!connectionById.get(requestedId)?.previewToken) {
        throw new Error(
          `The localhost connection "${requestedId}" has no preview token. Run design connect again, then retry.`,
        );
      }
    }

    if (connectionId) {
      const connection = connectionById.get(connectionId);
      if (!connection) {
        throw new Error(
          `The localhost connection "${connectionId}" could not be found.`,
        );
      }
      return {
        previewToken: connection.previewToken,
        bridgeUrl: connection.bridgeUrl,
      };
    }

    if (connections.length === 0) {
      throw new Error(
        "The localhost connections have no preview tokens. Run design connect again, then retry.",
      );
    }

    return {
      connections: Object.fromEntries(
        requestedConnectionIds.map((requestedId) => {
          const connection = connectionById.get(requestedId)!;
          return [
            requestedId,
            {
              previewToken: connection.previewToken!,
              bridgeUrl: connection.bridgeUrl,
            },
          ];
        }),
      ),
    };
  },
});
