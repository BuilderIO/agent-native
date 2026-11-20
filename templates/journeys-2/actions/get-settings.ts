import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "Read workspace settings: email (sending domain authentication, default sender, communication limits, footer), utm (global UTM parameters) and mmc (monthly marketed contacts plan).",
  schema: z.object({}),
  outputSchema: z.object({ settings: z.record(z.string(), z.unknown()), mmcUsed: z.number() }),
  errors,
  readOnly: true,
  http: { method: "GET" },
  run: async () => {
    await ready();
    const [rows, contacts] = await Promise.all([getDb().select().from(schema.settings), getDb().select().from(schema.contacts)]);
    return { settings: Object.fromEntries(rows.map((r) => [r.key, r.value])), mmcUsed: contacts.filter((c) => c.subscribed).length * 330 };
  },
});
