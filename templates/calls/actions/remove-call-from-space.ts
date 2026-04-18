import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";
import { parseSpaceIds, stringifySpaceIds } from "../server/lib/calls.js";

export default defineAction({
  description: "Remove a space id from a call's space_ids list.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
    spaceId: z.string().describe("Space ID to remove"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    await assertAccess("call", args.callId, "editor");
    const db = getDb();
    const [row] = await db
      .select({ spaceIds: schema.calls.spaceIds })
      .from(schema.calls)
      .where(eq(schema.calls.id, args.callId));
    if (!row) throw new Error(`Call not found: ${args.callId}`);

    const next = parseSpaceIds(row.spaceIds).filter((id) => id !== args.spaceId);

    await db
      .update(schema.calls)
      .set({
        spaceIds: stringifySpaceIds(next),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.calls.id, args.callId));

    await writeAppState("refresh-signal", { ts: Date.now() });
    return { id: args.callId, spaceIds: next };
  },
});
