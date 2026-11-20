import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "Workspace overview: journey counts by status, contacts, accounts, emails sent in the last 30 days with open and click rates, and the top journeys by entries.",
  schema: z.object({}),
  outputSchema: z.object({ overview: z.record(z.string(), z.unknown()) }),
  errors,
  readOnly: true,
  http: { method: "GET" },
  run: async () => {
    await ready();
    const db = getDb();
    const [journeys, contacts, accounts, sends] = await Promise.all([
      db.select().from(schema.journeys), db.select({ id: schema.contacts.id }).from(schema.contacts),
      db.select({ id: schema.accounts.id }).from(schema.accounts), db.select().from(schema.sends),
    ]);
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const recent = sends.filter((s) => s.day >= cutoff);
    const sum = (key: "sent" | "delivered" | "opened" | "clicked") => recent.reduce((n, s) => n + s[key], 0);
    const byStatus: Record<string, number> = {};
    for (const j of journeys) byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
    return {
      overview: {
        journeysByStatus: byStatus, contacts: contacts.length, accounts: accounts.length,
        sent30d: sum("sent"), openRate: sum("delivered") ? Math.round((sum("opened") / sum("delivered")) * 1000) / 10 : 0,
        clickRate: sum("delivered") ? Math.round((sum("clicked") / sum("delivered")) * 1000) / 10 : 0,
        topJourneys: journeys.sort((a, b) => b.entered - a.entered).slice(0, 5).map((j) => ({ id: j.id, name: j.name, status: j.status, entered: j.entered })),
      },
    };
  },
});
