import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";
import { getCallOrThrow, nanoid } from "../server/lib/calls.js";

export default defineAction({
  description: "Add a tag to a call. Idempotent — no duplicate for the same (call, tag).",
  schema: z.object({
    callId: z.string().describe("Call ID"),
    tag: z.string().min(1).max(64).describe("Tag text"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    await assertAccess("call", args.callId, "editor");
    const call = await getCallOrThrow(args.callId);
    const db = getDb();
    const tag = args.tag.trim();
    if (!tag) throw new Error("tag must not be empty");

    const [existing] = await db
      .select({ id: schema.callTags.id })
      .from(schema.callTags)
      .where(
        and(
          eq(schema.callTags.callId, args.callId),
          eq(schema.callTags.tag, tag),
        ),
      );

    if (!existing) {
      await db.insert(schema.callTags).values({
        id: nanoid(),
        callId: args.callId,
        workspaceId: call.workspaceId,
        tag,
      });
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    const tags = await db
      .select({ tag: schema.callTags.tag })
      .from(schema.callTags)
      .where(eq(schema.callTags.callId, args.callId));

    return { id: args.callId, tags: tags.map((t) => t.tag) };
  },
});
