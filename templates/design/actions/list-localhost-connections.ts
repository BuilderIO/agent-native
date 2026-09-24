import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolveLocalhostConnectionScope } from "../server/lib/localhost-connection.js";
import {
  designConnectionIdFromData,
  type DesignBridgeCapability,
  type LocalhostDesignRouteManifest,
} from "../shared/source-mode.js";

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export default defineAction({
  description:
    "List localhost Design source connections for the current user. Use this before creating localhost artboards or resolving local routes.",
  schema: z.object({
    id: z.string().optional().describe("Optional connection ID filter."),
    designId: z
      .string()
      .optional()
      .describe("Design ID used to scope a signed-out visual-edit request."),
    status: z
      .enum(["connected", "detected", "manual", "error"])
      .optional()
      .describe("Optional status filter."),
  }),
  readOnly: true,
  http: { method: "GET" },
  capabilityScopes: ["visual-edit"],
  run: async ({ id, designId, status }) => {
    let scopedId = id;
    if (!getRequestUserEmail() && designId) {
      const access = await resolveAccess("design", designId);
      const linkedId = designConnectionIdFromData(access?.resource?.data);
      if (!linkedId) {
        throw new Error("The visual-edit design has no localhost connection.");
      }
      if (scopedId && scopedId !== linkedId) {
        throw new Error(
          "The connection is not linked to this visual-edit design.",
        );
      }
      scopedId = linkedId;
    }
    const { ownerEmail, orgId } = await resolveLocalhostConnectionScope({
      designId,
    });
    const clauses = [
      eq(schema.designLocalhostConnections.ownerEmail, ownerEmail),
      orgId
        ? eq(schema.designLocalhostConnections.orgId, orgId)
        : isNull(schema.designLocalhostConnections.orgId),
    ];
    if (scopedId) {
      clauses.push(eq(schema.designLocalhostConnections.id, scopedId));
    }
    if (status) {
      clauses.push(eq(schema.designLocalhostConnections.status, status));
    }

    const rows = await getDb()
      .select()
      .from(schema.designLocalhostConnections)
      .where(and(...clauses))
      .orderBy(desc(schema.designLocalhostConnections.updatedAt));

    const connections = rows.map((row) => {
      const routeManifest = parseJson<LocalhostDesignRouteManifest>(
        row.routeManifest,
        {
          version: 1,
          sourceType: "localhost",
          devServerUrl: row.devServerUrl,
          rootPath: row.rootPath ?? undefined,
          routes: [],
          generatedAt: row.updatedAt ?? new Date(0).toISOString(),
        },
      );
      const capabilities = parseJson<DesignBridgeCapability[]>(
        row.capabilities,
        [],
      );
      return {
        id: row.id,
        sourceType: row.sourceType,
        name: row.name,
        devServerUrl: row.devServerUrl,
        bridgeUrl: row.bridgeUrl ?? null,
        rootPath: row.rootPath ?? null,
        routeManifest,
        routes: routeManifest.routes,
        routeCount: routeManifest.routes.length,
        capabilities,
        status: row.status,
        lastSeenAt: row.lastSeenAt ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    return {
      count: connections.length,
      connections,
    };
  },
});
