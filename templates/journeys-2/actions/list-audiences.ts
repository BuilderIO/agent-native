import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { errors, evaluateAudience, ready } from "../server/core.js";
import { filterSchema } from "../shared/types.js";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "List audiences (dynamic lists, static lists and segments) with live member counts.",
  schema: z.object({ kind: z.enum(["dynamic", "static", "segment"]).optional().describe("Only this audience kind") }),
  outputSchema: z.object({ audiences: z.array(z.record(z.string(), z.unknown())) }),
  errors,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ kind }) => {
    await ready();
    const rows = (await getDb().select().from(schema.audiences)).filter((a) => !kind || a.kind === kind);
    const audiences = await Promise.all(rows.map(async (a) => ({
      id: a.id, name: a.name, kind: a.kind, updatedAt: a.updatedAt,
      size: (await evaluateAudience(filterSchema.parse(a.filter), a.kind, a.memberIds as string[])).matched.length,
    })));
    return { audiences };
  },
});
