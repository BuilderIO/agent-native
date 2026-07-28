import { defineAction } from "@agent-native/core/action";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { stays } from "../server/db/schema.js";
import { requireOwner } from "../server/lib/owner.js";

export default defineAction({
  description:
    "List presence-ledger stays (country entries/exits), newest first. Each stay has inclusive entryDate/exitDate calendar dates; a null exitDate means the user is still there. Optionally filter by ISO country code.",
  schema: z.object({
    countryCode: z
      .string()
      .length(2)
      .optional()
      .describe("Filter to one ISO 3166-1 alpha-2 country code, e.g. PT"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const owner = requireOwner();
    const db = getDb();
    const scope = args.countryCode
      ? and(
          eq(stays.ownerEmail, owner),
          eq(stays.countryCode, args.countryCode.toUpperCase()),
        )
      : eq(stays.ownerEmail, owner);
    return await db
      .select()
      .from(stays)
      .where(scope)
      .orderBy(desc(stays.entryDate));
  },
});
