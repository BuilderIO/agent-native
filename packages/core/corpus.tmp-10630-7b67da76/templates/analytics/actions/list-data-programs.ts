/**
 * Analytics HTTP surface for listing stored data programs.
 *
 * Core registers list-data-programs for the agent tool bag; template apps also
 * expose it here so extension iframes can call it via
 * /_agent-native/actions/list-data-programs.
 */
import { defineAction } from "@agent-native/core";
import { listDataPrograms } from "@agent-native/core/data-programs";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { ANALYTICS_APP_ID } from "../server/lib/provider-credentials";

export default defineAction({
  description:
    "List data programs for Analytics, scoped to what the caller can access.",
  schema: z.object({
    includeArchived: z.boolean().optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const ctx = getCredentialContext();
    if (!ctx)
      throw new Error("No authenticated context for list-data-programs.");

    const programs = await listDataPrograms(
      ANALYTICS_APP_ID,
      { userEmail: ctx.userEmail, orgId: ctx.orgId ?? undefined },
      { includeArchived: args.includeArchived },
    );

    return {
      programs: programs.map((p) => ({
        id: p.id,
        name: p.name,
        title: p.title,
        description: p.description,
        refreshMode: p.refreshMode,
        refreshTtlMs: p.refreshTtlMs,
        background: p.background,
        archivedAt: p.archivedAt,
        updatedAt: p.updatedAt,
        columns: p.outputColumns ? JSON.parse(p.outputColumns) : [],
      })),
    };
  },
});
