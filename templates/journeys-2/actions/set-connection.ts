import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, nowIso, ready } from "../server/core.js";

export default defineAction({
  description: "Connect, disconnect or trigger a sync on a data connection. This demo simulates providers; no external service is contacted.",
  schema: z.object({
    id: z.string().min(1).describe("Connection id"),
    action: z.enum(["connect", "disconnect", "sync"]).describe("connect, disconnect, or sync now"),
  }),
  outputSchema: z.object({ id: z.string(), status: z.string() }),
  errors,
  run: async ({ id, action }) => {
    await ready();
    const [row] = await getDb().select().from(schema.connections).where(eq(schema.connections.id, id));
    if (!row) return errors.noWrite("Connection not found.", "not_found", { statusCode: 404 });
    if (action === "sync" && row.status !== "connected")
      return errors.noWrite("Connect it before syncing.", "conflict", { statusCode: 409 });
    const status = action === "disconnect" ? "disconnected" : "connected";
    await getDb().update(schema.connections).set({
      status,
      detail: action === "connect" ? "Connected just now" : action === "disconnect" ? "" : row.detail,
      lastSyncAt: action === "disconnect" ? null : nowIso(),
    }).where(eq(schema.connections.id, id));
    return { id, status };
  },
});
