import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description: "Remove a tag from a call.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
    tag: z.string().min(1).describe("Tag text to remove"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    await assertAccess("call", args.callId, "editor");
    const db = getDb();
    await db
      .delete(schema.callTags)
      .where(
        and(
          eq(schema.callTags.callId, args.callId),
          eq(schema.callTags.tag, args.tag),
        ),
      );
    await writeAppState("refresh-signal", { ts: Date.now() });
    const tags = await db
      .select({ tag: schema.callTags.tag })
      .from(schema.callTags)
      .where(eq(schema.callTags.callId, args.callId));
    return { id: args.callId, tags: tags.map((t) => t.tag) };
  },
});
