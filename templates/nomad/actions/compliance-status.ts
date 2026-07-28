import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { rules, stays, visas } from "../server/db/schema.js";
import { requireOwner } from "../server/lib/owner.js";
import { getProfile } from "../server/lib/profile.js";
import { computeSnapshot, isValidISODate } from "../shared/compliance.js";
import type { Rule, Stay, Visa } from "../shared/types.js";

export default defineAction({
  description:
    "Compute the full residency-compliance snapshot: current location, per-rule day counts (used/remaining/percent, traffic-light severity, projected must-exit-by and re-entry dates), per-country statuses for the map, active alerts (rule warnings + pending inbox-detected trips), recent trips, and the user profile. This is the primary read for any 'where can I be / how many days do I have left' question. Optionally pass asOf to compute for a different date.",
  schema: z.object({
    asOf: z
      .string()
      .optional()
      .describe(
        "Compute the snapshot as of this YYYY-MM-DD date (default: today)",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    if (args.asOf && !isValidISODate(args.asOf)) {
      throw new Error("asOf must be a valid YYYY-MM-DD date");
    }
    const owner = requireOwner();
    const db = getDb();
    const [stayRows, ruleRows, visaRows, profile] = await Promise.all([
      db.select().from(stays).where(eq(stays.ownerEmail, owner)),
      db.select().from(rules).where(eq(rules.ownerEmail, owner)),
      db.select().from(visas).where(eq(visas.ownerEmail, owner)),
      getProfile(),
    ]);
    return computeSnapshot(
      stayRows as Stay[],
      ruleRows as Rule[],
      profile,
      args.asOf,
      visaRows as Visa[],
    );
  },
});
