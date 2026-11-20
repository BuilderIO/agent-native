import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "List personalization tokens (name, source field, fallback value and value-mapping rules) usable as {{name}} in emails and in Branch by token steps.",
  schema: z.object({}),
  outputSchema: z.object({ tokens: z.array(z.record(z.string(), z.unknown())) }),
  errors,
  readOnly: true,
  http: { method: "GET" },
  run: async () => {
    await ready();
    return { tokens: await getDb().select().from(schema.tokens) };
  },
});
