import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "List workspace users with role (admin, editor, viewer) and status (active, invited).",
  schema: z.object({}),
  outputSchema: z.object({ users: z.array(z.record(z.string(), z.unknown())) }),
  errors,
  readOnly: true,
  http: { method: "GET" },
  run: async () => {
    await ready();
    return { users: await getDb().select().from(schema.users) };
  },
});
