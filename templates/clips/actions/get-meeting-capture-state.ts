import { defineAction } from "@agent-native/core/action";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Read the stop revision and end time for an accessible meeting, including trashed meetings, so active native capture can observe its closure. Missing or inaccessible meetings return unavailable; read failures throw.",
  agentTool: false,
  schema: z.object({ id: z.string().describe("Persisted meeting id") }),
  http: { method: "GET" },
  run: async ({ id }) => {
    const access = await resolveAccess("meeting", id, undefined, {
      skipResourceBody: true,
    });
    if (!access) return { meeting: null, reason: "unavailable" as const };
    const [meeting] = await getDb()
      .select({
        actualEnd: schema.meetings.actualEnd,
        captureStopRevision: schema.meetings.captureStopRevision,
      })
      .from(schema.meetings)
      .where(eq(schema.meetings.id, id))
      .limit(1);
    if (!meeting) return { meeting: null, reason: "unavailable" as const };
    return { meeting };
  },
});
