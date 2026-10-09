import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { putOrgSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import {
  sourceIndexBundleSchema,
  type SourceIndexBundle,
} from "../server/lib/source-index-schema.js";
import {
  invalidateSourceIndexCache,
  SOURCE_INDEX_SETTING_KEY,
} from "../server/lib/source-index-store.js";

export default defineAction({
  description:
    "Replace the organization’s generated Analytics source index. Requires an organization owner or admin. The index contains source metadata only; its entries remain unapproved suggestions and never replace live schema or query verification.",
  mcpTool: false,
  schema: z.object({ bundle: sourceIndexBundleSchema }),
  run: async ({ bundle }, ctx) => {
    const admin = await requireAnalyticsAdminContext({
      userEmail: getRequestUserEmail() || ctx?.userEmail,
      orgId: getRequestOrgId() || ctx?.orgId || null,
    });
    const index = bundle as SourceIndexBundle;
    await putOrgSetting(admin.orgId, SOURCE_INDEX_SETTING_KEY, index);
    invalidateSourceIndexCache(admin.orgId);
    const scanSummary = index.scanSummary ?? null;
    return {
      entryCount: index.entries.length,
      generatedAt: index.generatedAt,
      sources: index.sources.map((source) => source.id),
      scanSummary,
      message: scanSummary
        ? `Replaced the source index with ${index.entries.length} unapproved entries; omitted ${scanSummary.unsafeEntriesOmitted} unsafe entries and ${scanSummary.unsafeFieldsOmitted} unsafe fields, and marked ${scanSummary.truncatedFields} truncated fields.`
        : `Replaced the source index with ${index.entries.length} unapproved entries. Scan quality counts are unavailable for this bundle.`,
    };
  },
});
