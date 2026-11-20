import { defineAction } from "@agent-native/core/action";
import { desc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "List email assets in the library with kind (marketing, internal, transactional) and status.",
  schema: z.object({
    kind: z.enum(["marketing", "internal", "transactional"]).optional().describe("Only this kind"),
    search: z.string().max(200).optional().describe("Search name or subject"),
  }),
  outputSchema: z.object({ emails: z.array(z.record(z.string(), z.unknown())) }),
  errors,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ kind, search }) => {
    await ready();
    const q = search?.toLowerCase();
    const rows = await getDb().select().from(schema.emails).orderBy(desc(schema.emails.updatedAt));
    return { emails: rows.filter((e) => (!kind || e.kind === kind) && (!q || e.name.toLowerCase().includes(q) || e.subject.toLowerCase().includes(q))) };
  },
});
