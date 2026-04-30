import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/calls.js";

export default defineAction({
  description:
    "Return whether the current user has connected Zoom Cloud recording import.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const ownerEmail = getCurrentOwnerEmail();
    const db = getDb();

    const [connection] = await db
      .select({
        email: schema.zoomConnections.email,
        expiresAt: schema.zoomConnections.expiresAt,
        autoImport: schema.zoomConnections.autoImport,
      })
      .from(schema.zoomConnections)
      .where(eq(schema.zoomConnections.email, ownerEmail))
      .limit(1);

    return {
      connected: Boolean(connection),
      email: connection?.email ?? null,
      expiresAt: connection?.expiresAt ?? null,
      autoImport: connection?.autoImport ?? true,
    };
  },
});
