import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/calls.js";

export default defineAction({
  description: "Update Zoom Cloud import preferences for the current user.",
  schema: z.object({
    autoImport: z.boolean().describe("Whether new Zoom recordings auto-import"),
  }),
  run: async (args) => {
    const ownerEmail = getCurrentOwnerEmail();
    const db = getDb();

    const [connection] = await db
      .select({ email: schema.zoomConnections.email })
      .from(schema.zoomConnections)
      .where(eq(schema.zoomConnections.email, ownerEmail))
      .limit(1);

    if (!connection) {
      throw new Error("Zoom is not connected for this user.");
    }

    await db
      .update(schema.zoomConnections)
      .set({
        autoImport: args.autoImport,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.zoomConnections.email, ownerEmail));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      connected: true,
      email: ownerEmail,
      autoImport: args.autoImport,
    };
  },
});
