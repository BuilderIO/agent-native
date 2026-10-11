import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  readSourceIndex,
  sourceIndexFreshness,
} from "../server/lib/source-index-store.js";

export default defineAction({
  description:
    "Read the status and aggregate metadata for the organization’s imported source index. Does not return index contents.",
  schema: z.object({}),
  readOnly: true,
  http: { method: "GET" },
  mcpTool: false,
  run: async () => {
    if (!getRequestUserEmail()) {
      fail("An authenticated user is required to read index status.", {
        errorCode: "authentication_required",
        statusCode: 401,
      });
    }
    const result = await readSourceIndex(getRequestOrgId() || null);
    if (result.status !== "available") return { status: result.status };
    const freshness = sourceIndexFreshness(result.bundle.generatedAt);
    const entryCountsBySource = new Map<string, number>();
    for (const entry of result.bundle.entries) {
      entryCountsBySource.set(
        entry.source,
        (entryCountsBySource.get(entry.source) ?? 0) + 1,
      );
    }
    return {
      status: result.status,
      generatedAt: result.bundle.generatedAt,
      entryCount: result.bundle.entries.length,
      unresolvedTrackingCallSites:
        result.bundle.scanSummary?.unresolvedTrackingCallSites ?? 0,
      sources: result.bundle.sources,
      sourceCounts: result.bundle.sources.map(({ id }) => ({
        source: id,
        entryCount: entryCountsBySource.get(id) ?? 0,
      })),
      ...freshness,
    };
  },
});
