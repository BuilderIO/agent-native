import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/calls.js";
import {
  deleteAppState,
  writeAppState,
} from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Disconnect Zoom — delete the stored tokens for the current user. The user must reconnect to resume auto-import.",
  schema: z.object({}),
  http: { method: "POST" },
  run: async () => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    await db
      .delete(schema.zoomConnections)
      .where(eq(schema.zoomConnections.email, ownerEmail));
    await deleteAppState(`zoom-oauth-${ownerEmail}`);
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { disconnected: true, email: ownerEmail };
  },
});
