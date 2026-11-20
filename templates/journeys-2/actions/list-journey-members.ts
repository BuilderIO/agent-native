import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, ready } from "../server/core.js";

export default defineAction({
  description: "Journey member report: contacts that entered a journey with entry date, exit date, status and current step.",
  schema: z.object({
    id: z.string().min(1).describe("Journey id"),
    status: z.enum(["active", "completed", "exited"]).optional().describe("Only members with this status"),
    search: z.string().max(200).optional().describe("Search by contact name or email"),
  }),
  outputSchema: z.object({ members: z.array(z.record(z.string(), z.unknown())) }),
  errors,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id, status, search }) => {
    await ready();
    const db = getDb();
    const [rows, contacts] = await Promise.all([
      db.select().from(schema.members).where(eq(schema.members.journeyId, id)),
      db.select().from(schema.contacts),
    ]);
    const byId = new Map(contacts.map((c) => [c.id, c]));
    const q = search?.toLowerCase();
    const members = rows
      .filter((m) => !status || m.status === status)
      .map((m) => ({ ...m, name: byId.get(m.contactId)?.name ?? "", email: byId.get(m.contactId)?.email ?? "" }))
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      .sort((a, b) => b.enteredAt.localeCompare(a.enteredAt));
    return { members };
  },
});
