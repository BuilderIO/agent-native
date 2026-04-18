import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";
import { parseSpaceIds, stringifySpaceIds } from "../server/lib/calls.js";

export default defineAction({
  description: "Append a space id to a call's space_ids list (no-op if already present).",
  schema: z.object({
    callId: z.string().describe("Call ID"),
    spaceId: z.string().describe("Space ID to append"),
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

    const current = parseSpaceIds(row.spaceIds);
    const next = current.includes(args.spaceId)
      ? current
      : [...current, args.spaceId];

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
