import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  DesignBridgeCapability,
  LocalhostDesignRouteManifest,
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
    status: z
      .enum(["connected", "detected", "manual", "error"])
      .optional()
      .describe("Optional status filter."),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id, status }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() ?? null;
    const clauses = [
      eq(schema.designLocalhostConnections.ownerEmail, ownerEmail),
      orgId
        ? eq(schema.designLocalhostConnections.orgId, orgId)
        : isNull(schema.designLocalhostConnections.orgId),
    ];
    if (id) clauses.push(eq(schema.designLocalhostConnections.id, id));
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
