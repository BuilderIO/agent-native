import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "List accounts ranked by account score (0 to 100) with tier, plan, owner, renewal date, signals and contact count.",
  schema: z.object({
    search: z.string().max(200).optional().describe("Search name or domain"),
    minScore: z.coerce.number().int().min(0).max(100).default(0).describe("Minimum score; defaults to 0"),
  }),
  outputSchema: z.object({ accounts: z.array(z.record(z.string(), z.unknown())) }),
  errors,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ search, minScore }) => {
    await ready();
    const [accounts, contacts] = await Promise.all([getDb().select().from(schema.accounts), getDb().select().from(schema.contacts)]);
    const counts = new Map<string, number>();
    for (const c of contacts) if (c.accountId) counts.set(c.accountId, (counts.get(c.accountId) ?? 0) + 1);
    const q = search?.toLowerCase();
    return {
      accounts: accounts
        .filter((a) => a.score >= minScore && (!q || a.name.toLowerCase().includes(q) || a.domain.toLowerCase().includes(q)))
        .sort((a, b) => b.score - a.score)
        .map((a) => ({ ...a, tier: a.score >= 80 ? "Hot" : a.score >= 50 ? "Warm" : "Cold", contacts: counts.get(a.id) ?? 0 })),
    };
  },
});
