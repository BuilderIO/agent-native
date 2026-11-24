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
    "For another app's link card, as the caller: names each linked item the caller can open, and answers only unavailable for the rest. Read-only.",
  schema: linkSummaryRequestSchema,
  outputSchema: linkSummaryResultSchema,
  http: false,
  readOnly: true,
  agentTool: false,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ links }) =>
    answerLinkSummaries({
      app: "slides",
      links,
      basePath: getConfiguredAppBasePath(),
      readTitle: async ({ id }) => {
        const access = await resolveAccess("deck", id, undefined, {
          skipResourceBody: true,
        });
        if (!access) return null;
        const rows = await getDb()
          .select({ title: schema.decks.title })
          .from(schema.decks)
          .where(eq(schema.decks.id, id))
          .limit(1);
        for (const row of rows) return row.title;
        return null;
      },
    }),
});
