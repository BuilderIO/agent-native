import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  contentCollectionConfigSchema,
  searchConsoleSiteSchema,
  storedSearchConsoleSiteSchema,
} from "../server/lib/content-metrics/config.js";
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
    ga4: cliBoolean
      .optional()
      .describe("Collect daily GA4 pageviews for each blog article."),
    searchConsole: cliBoolean
      .optional()
      .describe(
        "Collect daily Search Console clicks and impressions. Turn on only after a property owner has given the service account access.",
      ),
    searchConsoleSites: z
      .array(storedSearchConsoleSiteSchema)
      .max(20)
      .optional()
      .describe(
        'Search Console properties to collect, replacing the saved list, e.g. [{"siteUrl":"sc-domain:example.com","pathPrefix":"/blog/"}].',
      ),
  }),
  run: async (
    { enabled, builderBlog, ga4, searchConsole, searchConsoleSites },
    ctx,
  ) => {
    const admin = await requireAnalyticsAdminContext({
      userEmail: getRequestUserEmail() || ctx?.userEmail,
      orgId: getRequestOrgId() || ctx?.orgId || null,
    });
    const scope = { ownerEmail: admin.userEmail, orgId: admin.orgId };
    const current = await readContentCollection(scope);
    const saved = current?.config ?? contentCollectionConfigSchema.parse({});
    const config = contentCollectionConfigSchema.parse({
      ...saved,
      ...(builderBlog === undefined
        ? {}
        : { builderBlog: { enabled: builderBlog } }),
      ...(ga4 === undefined ? {} : { ga4: { enabled: ga4 } }),
      searchConsole: {
        enabled: searchConsole ?? saved.searchConsole.enabled,
        sites: searchConsoleSites ?? saved.searchConsole.sites,
      },
    });
    if (enabled && config.searchConsole.enabled) {
      z.array(searchConsoleSiteSchema)
        .max(20)
        .parse(config.searchConsole.sites);
    }
    await writeContentCollection(scope, { enabled, config });
    return readContentCollectionStatus(admin.orgId, admin.userEmail);
  },
});
