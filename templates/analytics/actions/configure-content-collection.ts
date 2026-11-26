import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { installBuiltinDashboardOnce } from "../server/lib/builtin-dashboards.js";
import {
  agentNativeSignupsSettingsUpdateSchema,
  contentCollectionConfigSchema,
  ga4PropertyIdSchema,
  searchConsoleHistoryMonthsSchema,
  searchConsoleQueriesPerPageSchema,
  searchConsoleSiteSchema,
  signupsSettingsUpdateSchema,
  storedSearchConsoleSiteSchema,
  xAccountSchema,
  xLinkTargetSchema,
  xTermSchema,
  youtubeChannelSchema,
} from "../server/lib/content-metrics/config.js";
import { readContentCollectionStatus } from "../server/lib/content-metrics/status.js";
import {
  readContentCollection,
  writeContentCollection,
} from "../server/lib/content-metrics/store.js";
import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import { cliBoolean } from "./schema-helpers.js";

const CONTENT_VIEW_DASHBOARD_ID = "content-view";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  description:
    "Turn the organization's daily Content view collection on or off and choose its steps. Requires an organization owner or admin. The caller becomes the stored owner: the daily job resolves provider connections as them. Omitted step settings keep their saved values. Turning collection on also lists the built-in Content dashboard in the organization's Dashboards; the result's contentDashboardId opens it at /dashboards/<id>.",
  schema: z.object({
    enabled: cliBoolean.describe("Whether the daily collection runs."),
    builderBlog: cliBoolean
      .optional()
      .describe("Collect the Builder blog article list with authors."),
    ga4: cliBoolean
      .optional()
      .describe("Collect daily GA4 pageviews for each blog article."),
    ga4PropertyId: ga4PropertyIdSchema
      .nullable()
      .optional()
      .describe(
        "Numeric GA4 property ID that measures the blog. Required for this collection's pageviews; never falls back to the shared GA4_PROPERTY_ID. Omit to keep the saved value or pass null to clear it.",
      ),
    dailyDev: cliBoolean
      .optional()
      .describe(
        "Collect daily visits from daily.dev to each blog article (on by default). Reads sessions that landed with daily.dev's via=dailydev tag or referrer from the same GA4 property, so it needs no other connection.",
      ),
    searchConsole: cliBoolean
      .optional()
      .describe(
        "Collect daily Search Console clicks, impressions and average position. Turn on only after a property owner has given the service account access.",
      ),
    searchConsoleHistoryMonths: z.coerce
      .number<string | number>()
      .pipe(searchConsoleHistoryMonthsSchema)
      .optional()
      .describe(
        "How many months back to fill Search Console history, 1 to 16 (default 16, all Search Console keeps). The first run reads the last 90 days; later runs fill older days 90 at a time, and query weeks a few at a time.",
      ),
    searchConsoleQueries: cliBoolean
      .optional()
      .describe(
        "Collect each page's top Search Console queries per week (on by default whenever Search Console is). The API is free.",
      ),
    searchConsoleQueriesPerPage: z.coerce
      .number<string | number>()
      .pipe(searchConsoleQueriesPerPageSchema)
      .optional()
      .describe(
        "Most queries kept per page per week, by impressions, 1 to 100 (default 25). Changing it reads the query history again.",
      ),
    searchConsoleSites: z
      .array(storedSearchConsoleSiteSchema)
      .max(20)
      .optional()
      .describe(
        'Search Console properties to collect, replacing the saved list, e.g. [{"siteUrl":"sc-domain:example.com","pathPrefix":"/blog/"}].',
      ),
    signups: signupsSettingsUpdateSchema
      .optional()
      .describe(
        "Per-article signups settings, merged into the saved ones: enabled, signupEventsTable and firstPageviewsTable (project.dataset.table), signupSource (its signups are also counted on their own), signupsSince (YYYY-MM-DD) and maxBytesBilled. The step stays not set up until all are set; measure maxBytesBilled with estimate-content-signups-cost, and get it approved before turning the step on, since every run scans the warehouse.",
      ),
    agentNativeSignups: agentNativeSignupsSettingsUpdateSchema
      .optional()
      .describe(
        "Agent-Native signups settings, merged into the saved ones: enabled, eventsTable (this organization's first-party analytics events, project.dataset.table) and maxBytesBilled. Signups whose link has utm_source set to the blog's host and utm_content set to an article's handle count for that article, as Agent-Native signups. Measure maxBytesBilled with estimate-content-signups-cost and get it approved before turning the step on, since every run scans the warehouse.",
      ),
    youtube: cliBoolean
      .optional()
      .describe(
        "Collect every video on youtubeChannels with its lifetime views, likes and comments, read once a day. Needs a YouTube Data API key under Data Sources; a run costs about one quota unit per 25 videos of the key's 10,000 a day.",
      ),
    youtubeChannels: z
      .array(youtubeChannelSchema)
      .max(20)
      .optional()
      .describe(
        'YouTube channels to collect, replacing the saved list, each a channel ID or @handle, e.g. ["@Builderio"]. A run reads at most 10,000 videos in all.',
      ),
    x: cliBoolean
      .optional()
      .describe(
        "Collect posts from xAccounts through the official X API once a day: each new post when first seen, then its views, likes, reposts and replies again at 1, 3, 7 and 30 days old, for the posts that count. Needs an X API Bearer token under Data Sources. X bills every post it returns, so the step stops before $25 of reads in a UTC calendar month.",
      ),
    xAccounts: z
      .array(xAccountSchema)
      .max(20)
      .optional()
      .describe(
        'X accounts to collect, replacing the saved list. With allPosts every post counts; otherwise a post counts only when it links under xLinks or names one of xTerms. Reposts and replies are never read. E.g. [{"handle":"@builderio","allPosts":true},{"handle":"@Steve8708"}].',
      ),
    xLinks: z
      .array(xLinkTargetSchema)
      .max(20)
      .optional()
      .describe(
        'Links that make a post count, replacing the saved list: a host and optional path, matched on the full address a link points to, subdomains included, e.g. ["builder.io/blog","agent-native.com"].',
      ),
    xTerms: z
      .array(xTermSchema)
      .max(20)
      .optional()
      .describe(
        'Words that make a post count when its text names them as a whole word, replacing the saved list. Terms with "@" or "." match any case and an @handle also matches a link to a post by that account, as a quote post carries; other terms match their exact case. E.g. ["Builder.io","@builderio","Agent-Native","Agent Native"].',
      ),
  }),
  run: async (
    {
      enabled,
      builderBlog,
      ga4,
      ga4PropertyId,
      dailyDev,
      searchConsole,
      searchConsoleSites,
      searchConsoleHistoryMonths,
      searchConsoleQueries,
      searchConsoleQueriesPerPage,
      signups,
      agentNativeSignups,
      youtube,
      youtubeChannels,
      x,
      xAccounts,
      xLinks,
      xTerms,
    },
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
      ga4: {
        enabled: ga4 ?? saved.ga4.enabled,
        propertyId:
          ga4PropertyId === undefined ? saved.ga4.propertyId : ga4PropertyId,
      },
      dailyDev: { enabled: dailyDev ?? saved.dailyDev.enabled },
      searchConsole: {
        enabled: searchConsole ?? saved.searchConsole.enabled,
        sites: searchConsoleSites ?? saved.searchConsole.sites,
        historyMonths:
          searchConsoleHistoryMonths ?? saved.searchConsole.historyMonths,
      },
      searchConsoleQueries: {
        enabled: searchConsoleQueries ?? saved.searchConsoleQueries.enabled,
        perPage:
          searchConsoleQueriesPerPage ?? saved.searchConsoleQueries.perPage,
      },
      signups: { ...saved.signups, ...signups },
      agentNativeSignups: {
        ...saved.agentNativeSignups,
        ...agentNativeSignups,
      },
      youtube: {
        enabled: youtube ?? saved.youtube.enabled,
        channels: youtubeChannels ?? saved.youtube.channels,
      },
      x: {
        enabled: x ?? saved.x.enabled,
        accounts: xAccounts ?? saved.x.accounts,
        links: xLinks ?? saved.x.links,
        terms: xTerms ?? saved.x.terms,
      },
    });
    if (enabled && config.searchConsole.enabled) {
      z.array(searchConsoleSiteSchema)
        .max(20)
        .parse(config.searchConsole.sites);
    }
    if (enabled) {
      await installBuiltinDashboardOnce(
        { email: admin.userEmail, orgId: admin.orgId },
        CONTENT_VIEW_DASHBOARD_ID,
      );
    }
    await writeContentCollection(scope, { enabled, config });
    return {
      ...(await readContentCollectionStatus(admin.orgId, admin.userEmail)),
      contentDashboardId: enabled ? CONTENT_VIEW_DASHBOARD_ID : null,
    };
  },
});
