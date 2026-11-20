import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { errors, newId, nowIso, ready , defined } from "../server/core.js";
import { filterSchema } from "../shared/types.js";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Create (omit id) or update (pass id) an audience. Dynamic lists and segments take a filter {logic, groups:[{logic, conditions}]}; conditions are type property (field, op, value), list (op in|not in, value audience id) or activity (field event key, op at least|at most|exactly|never, count, days). Static lists take memberIds.",
  schema: z.object({
    id: z.string().optional().describe("Audience id to update; omit to create"),
    name: z.string().min(1).max(200).optional().describe("Audience name"),
    kind: z.enum(["dynamic", "static", "segment"]).optional().describe("Audience kind; defaults to dynamic on create"),
    filter: filterSchema.optional().describe("Filter definition"),
    memberIds: z.array(z.string()).optional().describe("Contact ids (static lists)"),
  }),
  outputSchema: z.object({ id: z.string() }),
  errors,
  run: async ({ id, ...fields }) => {
    await ready();
    const now = nowIso();
    if (!id) {
      const newAudienceId = newId("aud");
      await getDb().insert(schema.audiences).values({ name: "Untitled audience", kind: "dynamic", filter: { logic: "and", groups: [] }, memberIds: [], ...defined(fields), id: newAudienceId, createdAt: now, updatedAt: now });
      return { id: newAudienceId };
    }
    const rows = await getDb().update(schema.audiences).set({ ...defined(fields), updatedAt: now }).where(eq(schema.audiences.id, id)).returning({ id: schema.audiences.id });
    if (rows.length === 0) return errors.noWrite("Audience not found.", "not_found", { statusCode: 404 });
    return { id };
  },
});
