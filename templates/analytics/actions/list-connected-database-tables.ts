import { defineAction } from "@agent-native/core/action";
import { listTables } from "@agent-native/core/db-admin";
import { z } from "zod";

import {
  listDbAdminConnections,
  requireDbAdminContextFromRequest,
  withDbAdminConnectionRuntime,
} from "../server/lib/db-admin-connections";

const MAX_DATABASES_PER_CATALOG = 20;

export default defineAction({
  description:
    "List the public tables and views available in the admin-connected agent-native app databases. Call this before db-admin-federated-read when table or column names are unknown. It requires an active organization owner/admin role and never returns database URLs, tokens, or secret values. Omit connectionIds to inspect every connected database, or pass a bounded subset.",
  schema: z.object({
    connectionIds: z
      .array(z.string().trim().min(1).max(200))
      .max(20)
      .optional(),
  }),
  outputSchema: z.object({
    connections: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        appId: z.string().nullable(),
        appUrl: z.string().nullable(),
        dialect: z.string(),
        tables: z.array(
          z.object({
            name: z.string(),
            type: z.enum(["table", "view"]),
            rowCount: z.number().nullable(),
          }),
        ),
      }),
    ),
  }),
  readOnly: true,
  grounding: true,
  run: async ({ connectionIds }, ctx) => {
    const admin = await requireDbAdminContextFromRequest(ctx);
    const connections = await listDbAdminConnections(admin);
    if (
      (!connectionIds || connectionIds.length === 0) &&
      connections.length > MAX_DATABASES_PER_CATALOG
    ) {
      throw new Error(
        `Specify at most ${MAX_DATABASES_PER_CATALOG} connectionIds when cataloging more than ${MAX_DATABASES_PER_CATALOG} databases.`,
      );
    }
    const selected = connectionIds?.length
      ? connections.filter((connection) =>
          connectionIds.includes(connection.id),
        )
      : connections;
    const selectedIds = new Set(selected.map((connection) => connection.id));
    const missing = (connectionIds ?? []).filter(
      (connectionId) => !selectedIds.has(connectionId),
    );
    if (missing.length > 0) {
      throw new Error(`Connected database not found: ${missing.join(", ")}`);
    }

    return {
      connections: await Promise.all(
        selected.map((connection) =>
          withDbAdminConnectionRuntime(
            admin,
            connection.id,
            async (runtime) => {
              const overview = await listTables(runtime);
              return {
                id: connection.id,
                name: connection.name,
                appId: connection.appId,
                appUrl: connection.appUrl,
                dialect: overview.dialect,
                tables: overview.tables,
              };
            },
          ),
        ),
      ),
    };
  },
});
