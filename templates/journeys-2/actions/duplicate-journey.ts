import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, newId, nowIso, ready } from "../server/core.js";

export default defineAction({
  description: "Copy a journey's canvas and settings into a new draft journey.",
  schema: z.object({ id: z.string().min(1).describe("Journey id to copy") }),
  outputSchema: z.object({ id: z.string() }),
  errors,
  run: async ({ id }) => {
    await ready();
    const [row] = await getDb().select().from(schema.journeys).where(eq(schema.journeys.id, id));
    if (!row) return errors.noWrite("Journey not found.", "not_found", { statusCode: 404 });
    const copyId = newId("jr");
    const now = nowIso();
    await getDb().insert(schema.journeys).values({ ...row, id: copyId, name: `${row.name} (copy)`, status: "draft", entered: 0, exited: 0, createdAt: now, updatedAt: now });
    return { id: copyId };
  },
});
