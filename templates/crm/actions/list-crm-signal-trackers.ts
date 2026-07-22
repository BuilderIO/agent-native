import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { asc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { DEFAULT_CRM_DETECTORS } from "../server/lib/intelligence/default-detectors.js";

export default defineAction({
  description:
    "List access-scoped CRM signal detectors and the safe default pack when none are configured.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const rows = await getDb()
      .select()
      .from(schema.crmSignalTrackers)
      .where(
        accessFilter(schema.crmSignalTrackers, schema.crmSignalTrackerShares),
      )
      .orderBy(asc(schema.crmSignalTrackers.name));
    return {
      trackers: rows.map((row) => ({
        ...row,
        keywords: JSON.parse(row.keywordsJson) as string[],
        keywordsJson: undefined,
      })),
      suggestedDefaults: rows.length ? [] : DEFAULT_CRM_DETECTORS,
    };
  },
});
