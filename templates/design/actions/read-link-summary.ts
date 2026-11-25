import { answerLinkSummaries } from "@agent-native/core/a2a";
import { defineAction } from "@agent-native/core/action";
import { getConfiguredAppBasePath } from "@agent-native/core/server";
import {
  linkSummaryRequestSchema,
  linkSummaryResultSchema,
} from "@agent-native/core/shared";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Summarize Design links for another app's link card, as the caller: each design's title when the caller can open it, otherwise only unavailable. Reads titles; changes nothing.",
  schema: linkSummaryRequestSchema,
  outputSchema: linkSummaryResultSchema,
  http: false,
  readOnly: true,
  agentTool: false,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ links }) =>
    answerLinkSummaries({
      app: "design",
      links,
      basePath: getConfiguredAppBasePath(),
      readTitle: async ({ id }) => {
        const access = await resolveAccess("design", id, undefined, {
          skipResourceBody: true,
        });
        if (!access) return null;
        const rows = await getDb()
          .select({ title: schema.designs.title })
          .from(schema.designs)
          .where(eq(schema.designs.id, id))
          .limit(1);
        for (const row of rows) return row.title;
        return null;
      },
    }),
});
