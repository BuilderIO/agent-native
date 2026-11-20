import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "Agent-only: read what is on screen now: the current view and path, and the open journey, email, audience or contact if one is selected. Use it before editing the open item.",
  schema: z.object({}),
  outputSchema: z.object({ navigation: z.record(z.string(), z.unknown()), open: z.record(z.string(), z.unknown()).nullable() }),
  errors,
  http: false,
  readOnly: true,
  run: async () => {
    await ready();
    const navigation = ((await readAppState("navigation")) ?? {}) as { view?: string; id?: string };
    const db = getDb();
    const id = navigation.id;
    let open: Record<string, unknown> | null = null;
    if (id) {
      const table = { journeys: schema.journeys, emails: schema.emails, audiences: schema.audiences, contacts: schema.contacts }[navigation.view ?? ""];
      if (table) {
        const [row] = await db.select().from(table).where(eq(table.id, id));
        open = row ? { kind: navigation.view, ...row } : null;
      }
    }
    return { navigation, open };
  },
});
