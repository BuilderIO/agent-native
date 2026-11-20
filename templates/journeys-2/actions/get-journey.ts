import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "Read one journey with its full canvas: steps (nodes with type, position and config), connections (edges) and settings.",
  schema: z.object({ id: z.string().min(1).describe("Journey id") }),
  outputSchema: z.object({ journey: z.record(z.string(), z.unknown()) }),
  errors,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id }) => {
    await ready();
    const [row] = await getDb().select().from(schema.journeys).where(eq(schema.journeys.id, id));
    if (!row) return errors.noWrite("Journey not found.", "not_found", { statusCode: 404 });
    return { journey: row };
  },
});
