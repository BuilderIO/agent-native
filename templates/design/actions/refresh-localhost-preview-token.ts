import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolveLocalhostConnectionScope } from "../server/lib/localhost-connection.js";
import { designConnectionIdsFromData } from "../shared/source-mode.js";
import {
  deriveLiveEditCapability,
  deriveLiveEditRegistrationCapability,
  derivePreviewToken,
} from "./connect-localhost.js";

export default defineAction({
  description:
    "Refresh localhost preview credentials. Public visual-edit viewers receive only a design-scoped registration capability for ephemeral DOM editing; the publicVisualEdit flag grants no pending-edit read, write, or agent handoff access.",
  schema: z.object({
    designId: z.string().describe("Design project ID."),
    connectionId: z
      .string()
      .optional()
      .describe(
        "Localhost connection ID. Omit both selectors to refresh all connections referenced by the design.",
      ),
    connectionIds: z
      .array(z.string())
      .optional()
      .describe(
        "Specific localhost connection IDs to refresh. Each ID must be referenced by the design. Use this instead of connectionId to refresh a subset.",
      ),
    publicVisualEdit: z
      .boolean()
      .optional()
      .describe(
        "Marks a public /visual-edit preview request; the flag grants no access by itself. The server verifies public visibility and may return read-only preview plus registration-only credentials. Pending edits and agent handoff still require the separate design-scoped capability.",
      ),
  }),
  readOnly: true,
  requiresAuth: false,
  http: { method: "GET" },
  capabilityScopes: ["visual-edit"],
  run: async ({ designId, connectionId, connectionIds, publicVisualEdit }) => {
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
    if (connectionId && connectionIds) {
      fail("Provide connectionId or connectionIds, not both.", {
        errorCode: "invalid_connection_selectors",
        statusCode: 400,
      });
    }
    const requestedConnectionIds = connectionId
      ? [connectionId]
      : connectionIds === undefined
        ? designConnectionIds
        : [...new Set(connectionIds)];
    if (requestedConnectionIds.length === 0) {
      const error = new Error(
        `Design "${designId}" has no localhost connections.`,
      ) as Error & { statusCode: number };
      error.statusCode = 403;
      throw error;
    }
    const unreferencedConnectionId = requestedConnectionIds.find(
      (requestedId) => !designConnectionIds.includes(requestedId),
    );
    if (unreferencedConnectionId) {
      const error = new Error(
        `Localhost connection "${unreferencedConnectionId}" is not part of design "${designId}".`,
      ) as Error & { statusCode: number };
      error.statusCode = 403;
      throw error;
    }
    const canIssueLiveEditCapability =
      access.role === "owner" ||
      access.role === "admin" ||
      access.role === "editor";
    const canIssueRegistrationCapability =
      canIssueLiveEditCapability || publicVisualEdit === true;
    const connectionScope =
      publicVisualEdit === true && access.role === "viewer"
        ? await resolveLocalhostConnectionScope({
            designId,
            allowPublicViewer: true,
          })
        : await resolveLocalhostConnectionScope();
    const { ownerEmail, orgId } = connectionScope;
    const connections = await getDb()
      .select({
        id: schema.designLocalhostConnections.id,
        previewToken: schema.designLocalhostConnections.previewToken,
        bridgeToken: schema.designLocalhostConnections.bridgeToken,
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
      const connection = connectionById.get(requestedId);
      if (!connection?.previewToken && !connection?.bridgeToken) {
        throw new Error(
          `The localhost connection "${requestedId}" has no preview token. Run design connect again, then retry.`,
        );
      }
    }

    const previewTokenFor = (connection: {
      bridgeToken?: string | null;
      previewToken?: string | null;
    }) =>
      connection.bridgeToken
        ? derivePreviewToken(connection.bridgeToken)
        : connection.previewToken;

    if (connectionId) {
      const connection = connectionById.get(connectionId);
      if (!connection) {
        throw new Error(
          `The localhost connection "${connectionId}" could not be found.`,
        );
      }
      return {
        previewToken: previewTokenFor(connection),
        ...(connection.bridgeToken
          ? {
              ...(canIssueLiveEditCapability
                ? {
                    liveEditCapability: deriveLiveEditCapability(
                      connection.bridgeToken,
                      designId,
                    ),
                  }
                : {}),
              ...(canIssueRegistrationCapability
                ? {
                    liveEditRegistrationCapability:
                      deriveLiveEditRegistrationCapability(
                        connection.bridgeToken,
                        designId,
                      ),
                  }
                : {}),
            }
          : {}),
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
              previewToken: previewTokenFor(connection)!,
              ...(connection.bridgeToken
                ? {
                    ...(canIssueLiveEditCapability
                      ? {
                          liveEditCapability: deriveLiveEditCapability(
                            connection.bridgeToken,
                            designId,
                          ),
                        }
                      : {}),
                    ...(canIssueRegistrationCapability
                      ? {
                          liveEditRegistrationCapability:
                            deriveLiveEditRegistrationCapability(
                              connection.bridgeToken,
                              designId,
                            ),
                        }
                      : {}),
                  }
                : {}),
              bridgeUrl: connection.bridgeUrl,
            },
          ];
        }),
      ),
    };
  },
});
