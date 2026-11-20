import { defineAction } from "@agent-native/core/action";
import { desc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "List journeys with status, audience, step count and entry totals. Optionally filter by status or name search.",
  schema: z.object({
    status: z.enum(["draft", "active", "paused", "finished"]).optional().describe("Only journeys in this status"),
    search: z.string().max(200).optional().describe("Case-insensitive name search"),
  }),
  outputSchema: z.object({ journeys: z.array(z.record(z.string(), z.unknown())) }),
  errors,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ status, search }) => {
    await ready();
    const [rows, audiences] = await Promise.all([
      getDb().select().from(schema.journeys).orderBy(desc(schema.journeys.updatedAt)),
      getDb().select().from(schema.audiences),
    ]);
    const names = new Map(audiences.map((a) => [a.id, a.name]));
    const journeys = rows
      .filter((j) => (!status || j.status === status) && (!search || j.name.toLowerCase().includes(search.toLowerCase())))
      .map((j) => ({
        id: j.id, name: j.name, status: j.status, kind: j.kind, goal: j.goal,
        audienceId: j.audienceId, audienceName: j.audienceId ? names.get(j.audienceId) ?? null : null,
        steps: (j.nodes as unknown[]).length, entered: j.entered, exited: j.exited, updatedAt: j.updatedAt,
      }));
    return { journeys };
  },
});
