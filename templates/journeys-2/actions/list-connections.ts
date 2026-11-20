import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "List data connections (CRM, event sources, data warehouses, web tracking, forms, webhooks) with connected status and last sync time.",
  schema: z.object({}),
  outputSchema: z.object({ connections: z.array(z.record(z.string(), z.unknown())) }),
  errors,
  readOnly: true,
  http: { method: "GET" },
  run: async () => {
    await ready();
    return { connections: await getDb().select().from(schema.connections) };
  },
});
