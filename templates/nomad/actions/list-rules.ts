import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { rules } from "../server/db/schema.js";
import { requireOwner } from "../server/lib/owner.js";

export default defineAction({
  description:
    "List the compliance rules being tracked (Schengen 90/180, 183-day tax residency, visa caps, PR presence minimums). Use compliance-status for computed day counts against each rule.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const db = getDb();
    return await db
      .select()
      .from(rules)
      .where(eq(rules.ownerEmail, requireOwner()));
  },
});
