import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { errors, loadPeople, ready } from "../server/core.js";

export default defineAction({
  description: "Search the contact database by name, email, company or title; filter by lifecycle stage. Returns a page and total.",
  schema: z.object({
    search: z.string().max(200).optional().describe("Search text"),
    lifecycleStage: z.string().optional().describe("Only this lifecycle stage"),
    offset: z.coerce.number().int().nonnegative().default(0).describe("Offset; defaults to 0"),
    limit: z.coerce.number().int().min(1).max(100).default(25).describe("Page size, 1 to 100; defaults to 25"),
  }),
  outputSchema: z.object({ contacts: z.array(z.record(z.string(), z.unknown())), total: z.number() }),
  errors,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ search, lifecycleStage, offset, limit }) => {
    await ready();
    const { contacts, accountById } = await loadPeople();
    const q = search?.toLowerCase();
    const rows = contacts.filter((c) => {
      const company = accountById.get(c.accountId ?? "")?.name ?? "";
      return (!lifecycleStage || c.lifecycleStage === lifecycleStage) &&
        (!q || [c.name, c.email, c.title, company].some((v) => v.toLowerCase().includes(q)));
    });
    return {
      total: rows.length,
      contacts: rows.slice(offset, offset + limit).map((c) => ({ id: c.id, name: c.name, email: c.email, title: c.title, company: accountById.get(c.accountId ?? "")?.name ?? "", lifecycleStage: c.lifecycleStage, source: c.source, subscribed: !!c.subscribed, lastActive: c.lastActive })),
    };
  },
});
