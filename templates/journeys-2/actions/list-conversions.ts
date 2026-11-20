import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "List conversion goals with event type, attribution window in days, linked journey and conversion count.",
  schema: z.object({}),
  outputSchema: z.object({ conversions: z.array(z.record(z.string(), z.unknown())) }),
  errors,
  readOnly: true,
  http: { method: "GET" },
  run: async () => {
    await ready();
    return { conversions: await getDb().select().from(schema.conversions) };
  },
});
