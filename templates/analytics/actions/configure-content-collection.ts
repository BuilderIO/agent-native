import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { contentCollectionConfigSchema } from "../server/lib/content-metrics/config.js";
import { readContentCollectionStatus } from "../server/lib/content-metrics/status.js";
import {
  readContentCollection,
  writeContentCollection,
} from "../server/lib/content-metrics/store.js";
import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import { cliBoolean } from "./schema-helpers.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  description:
    "Turn the organization's daily Content view collection on or off and choose its steps. Requires an organization owner or admin. The caller becomes the stored owner: the daily job resolves provider connections as them. Omitted step settings keep their saved values.",
  schema: z.object({
    enabled: cliBoolean.describe("Whether the daily collection runs."),
    builderBlog: cliBoolean
      .optional()
      .describe("Collect the Builder blog article list with authors."),
  }),
  run: async ({ enabled, builderBlog }, ctx) => {
    const admin = await requireAnalyticsAdminContext({
      userEmail: getRequestUserEmail() || ctx?.userEmail,
      orgId: getRequestOrgId() || ctx?.orgId || null,
    });
    const scope = { ownerEmail: admin.userEmail, orgId: admin.orgId };
    const current = await readContentCollection(scope);
    const config = contentCollectionConfigSchema.parse({
      ...current?.config,
      ...(builderBlog === undefined
        ? {}
        : { builderBlog: { enabled: builderBlog } }),
    });
    await writeContentCollection(scope, { enabled, config });
    return readContentCollectionStatus(admin.orgId, admin.userEmail);
  },
});
