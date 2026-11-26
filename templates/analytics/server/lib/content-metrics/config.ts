import { createHash } from "node:crypto";

import { z } from "zod";

import {
  normalizeSearchConsoleProperty,
  searchConsolePropertyMessage,
  searchConsolePropertyProblem,
} from "../../../shared/search-console-property.js";

/**
 * Collection steps, in the order the daily job runs them. A step's id is the
 * `step` stored on its collection runs and the `source` on what it writes.
 */
export const CONTENT_COLLECTION_STEPS = [
  "builder_blog",
  "ga4",
  "daily_dev",
  "search_console",
  "search_console_queries",
  "signups",
  "agent_native_signups",
  "youtube",
  "x",
] as const;
export type ContentCollectionStepId = (typeof CONTENT_COLLECTION_STEPS)[number];

const stepToggleSchema = z.object({ enabled: z.boolean() });

export const ga4PropertyIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9]+$/);

const ga4ConfigSchema = stepToggleSchema.extend({
  propertyId: ga4PropertyIdSchema.nullable().default(null),
});

/**
 * A Search Console property: `sc-domain:example.com` or a URL-prefix
 * property such as `https://www.example.com/`. `pathPrefix` keeps a large
 * site to the pages the Content view tracks.
 */
export const storedSearchConsoleSiteSchema = z.object({
  siteUrl: z.string().trim().min(1).transform(normalizeSearchConsoleProperty),
  pathPrefix: z.string().trim().startsWith("/").optional(),
});

export const searchConsoleHistoryMonthsSchema = z.number().int().min(1).max(16);

export const searchConsoleQueriesPerPageSchema = z
  .number()
  .int()
  .min(1)
  .max(100);

// Existing configs must stay readable so admins can correct or disable them.
export const searchConsoleSiteSchema = storedSearchConsoleSiteSchema.extend({
  siteUrl: storedSearchConsoleSiteSchema.shape.siteUrl.superRefine(
    (siteUrl, ctx) => {
      const problem = searchConsolePropertyProblem(siteUrl);
      if (problem) {
        ctx.addIssue({
          code: "custom",
          message: searchConsolePropertyMessage(siteUrl, problem),
        });
      }
    },
  ),
});
export type SearchConsoleSite = z.infer<typeof searchConsoleSiteSchema>;

export const youtubeChannelSchema = z
  .string()
  .trim()
  .regex(
    /^(UC[A-Za-z0-9_-]{22}|@[A-Za-z0-9._-]{3,100})$/,
    "Use a channel ID (UC...) or an @handle",
  );

export const xAccountSchema = z.object({
  handle: z
    .string()
    .trim()
    .regex(/^@[A-Za-z0-9_]{1,15}$/, "Use an X @handle"),
  allPosts: z.boolean().default(false),
});
export type XAccount = z.infer<typeof xAccountSchema>;

export const xAccountsSchema = z
  .array(xAccountSchema)
  .max(20)
  .superRefine((accounts, ctx) => {
    const seen = new Set<string>();
    accounts.forEach((account, index) => {
      const handle = account.handle.toLowerCase();
      if (seen.has(handle)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "handle"],
          message: `${account.handle} is already listed; X handles ignore case.`,
        });
      }
      seen.add(handle);
    });
  });

export const xLinkTargetSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[a-z0-9._~%-]+)*$/,
    "Use a host and optional path, such as builder.io/blog",
  );

export const xTermSchema = z.string().trim().min(2).max(50);

export const X_MONTHLY_CAP_USD = 25;

const bigQueryTableSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/,
    "Use project.dataset.table",
  );

const signupSourceSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_-]+$/);

/**
 * The per-article signups join reads the warehouse, so it stays off until an
 * admin names its tables and a bytes cap measured by a dry run.
 */
export const signupsConfigSchema = z.object({
  enabled: z.boolean(),
  /** Signup events with JSON `data` holding `visitorId`, `userId` and `signupSource`. */
  signupEventsTable: bigQueryTableSchema.nullable().default(null),
  /** One row per visitor's first pageview: `url`, `visitor_id`, `is_bot`, `created_date`. */
  firstPageviewsTable: bigQueryTableSchema.nullable().default(null),
  signupSource: signupSourceSchema.nullable().default(null),
  /** Earliest signup counted, as YYYY-MM-DD; it bounds the events scan. */
  signupsSince: z.iso.date().nullable().default(null),
  maxBytesBilled: z
    .number()
    .int()
    .positive()
    .max(750_000_000_000)
    .nullable()
    .default(null),
});

/**
 * A change to the signups settings: only the fields given. No defaults, so
 * merging it over the saved settings never resets one that was left out.
 */
export const signupsSettingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  signupEventsTable: bigQueryTableSchema.nullable().optional(),
  firstPageviewsTable: bigQueryTableSchema.nullable().optional(),
  signupSource: signupSourceSchema.nullable().optional(),
  signupsSince: z.iso.date().nullable().optional(),
  maxBytesBilled: z
    .number()
    .int()
    .positive()
    .max(750_000_000_000)
    .nullable()
    .optional(),
});
export type SignupsConfig = z.infer<typeof signupsConfigSchema>;

const maxBytesBilledSchema = z.number().int().positive().max(750_000_000_000);

export const agentNativeSignupsConfigSchema = z.object({
  enabled: z.boolean(),
  eventsTable: bigQueryTableSchema.nullable().default(null),
  maxBytesBilled: maxBytesBilledSchema.nullable().default(null),
});

export const agentNativeSignupsSettingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  eventsTable: bigQueryTableSchema.nullable().optional(),
  maxBytesBilled: maxBytesBilledSchema.nullable().optional(),
});
export type AgentNativeSignupsConfig = z.infer<
  typeof agentNativeSignupsConfigSchema
>;

export const contentCollectionConfigSchema = z.object({
  builderBlog: stepToggleSchema.default({ enabled: true }),
  ga4: ga4ConfigSchema.default({ enabled: true, propertyId: null }),
  dailyDev: stepToggleSchema.default({ enabled: true }),
  // Off until a property owner grants the service account access; a run
  // before then would only record "no access".
  searchConsole: stepToggleSchema
    .extend({
      sites: z.array(storedSearchConsoleSiteSchema).max(20).default([]),
      historyMonths: searchConsoleHistoryMonthsSchema.default(16),
    })
    .default({ enabled: false, sites: [], historyMonths: 16 }),
  searchConsoleQueries: stepToggleSchema
    .extend({ perPage: searchConsoleQueriesPerPageSchema.default(25) })
    .default({ enabled: true, perPage: 25 }),
  signups: signupsConfigSchema.default({
    enabled: false,
    signupEventsTable: null,
    firstPageviewsTable: null,
    signupSource: null,
    signupsSince: null,
    maxBytesBilled: null,
  }),
  agentNativeSignups: agentNativeSignupsConfigSchema.default({
    enabled: false,
    eventsTable: null,
    maxBytesBilled: null,
  }),
  youtube: stepToggleSchema
    .extend({ channels: z.array(youtubeChannelSchema).max(20).default([]) })
    .default({ enabled: false, channels: [] }),
  x: stepToggleSchema
    .extend({
      accounts: xAccountsSchema.default([]),
      links: z.array(xLinkTargetSchema).max(20).default([]),
      terms: z.array(xTermSchema).max(20).default([]),
    })
    .default({ enabled: false, accounts: [], links: [], terms: [] }),
});

export type ContentCollectionConfig = z.infer<
  typeof contentCollectionConfigSchema
>;

export function defaultContentCollectionConfig(): ContentCollectionConfig {
  return contentCollectionConfigSchema.parse({});
}

export function stepEnabled(
  config: ContentCollectionConfig,
  step: ContentCollectionStepId,
): boolean {
  switch (step) {
    case "builder_blog":
      return config.builderBlog.enabled;
    case "ga4":
      return config.ga4.enabled;
    case "daily_dev":
      return config.dailyDev.enabled;
    case "search_console":
      return config.searchConsole.enabled;
    case "search_console_queries":
      return (
        config.searchConsole.enabled && config.searchConsoleQueries.enabled
      );
    case "signups":
      return config.signups.enabled;
    case "agent_native_signups":
      return config.agentNativeSignups.enabled;
    case "youtube":
      return config.youtube.enabled;
    case "x":
      return config.x.enabled;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function ga4ConfigFingerprint(propertyId: string): string {
  return sha256(propertyId);
}

export function youtubeConfigFingerprint(channels: string[]): string {
  return sha256(JSON.stringify(channels));
}

export function xConfigFingerprint(
  x: Pick<ContentCollectionConfig["x"], "accounts" | "links" | "terms">,
): string {
  return sha256(
    JSON.stringify([
      x.accounts.map((account) => [
        account.handle.toLowerCase(),
        account.allPosts,
      ]),
      x.links,
      x.terms,
    ]),
  );
}

export function agentNativeSignupsConfigFingerprint(
  eventsTable: string,
): string {
  return sha256(eventsTable);
}

const SEARCH_CONSOLE_DATA_VERSION = 2;

export function searchConsoleConfigFingerprint(
  sites: ContentCollectionConfig["searchConsole"]["sites"],
): string {
  return sha256(
    JSON.stringify([
      SEARCH_CONSOLE_DATA_VERSION,
      sites.map((site) => [
        normalizeSearchConsoleProperty(site.siteUrl),
        site.pathPrefix?.trim() ?? "",
      ]),
    ]),
  );
}

export function searchConsoleQueriesConfigFingerprint(
  sites: ContentCollectionConfig["searchConsole"]["sites"],
  perPage: number,
): string {
  return sha256(
    JSON.stringify([searchConsoleConfigFingerprint(sites), perPage]),
  );
}

/**
 * The settings a step's saved data depends on, or null when nothing it saves
 * depends on them. A run's results are saved only while this still matches.
 */
export function contentStepConfigFingerprint(
  step: ContentCollectionStepId,
  config: ContentCollectionConfig,
): string | null {
  switch (step) {
    case "ga4":
    case "daily_dev":
      return config.ga4.propertyId
        ? ga4ConfigFingerprint(config.ga4.propertyId)
        : null;
    case "search_console":
      return searchConsoleConfigFingerprint(config.searchConsole.sites);
    case "search_console_queries":
      return searchConsoleQueriesConfigFingerprint(
        config.searchConsole.sites,
        config.searchConsoleQueries.perPage,
      );
    case "agent_native_signups":
      return config.agentNativeSignups.eventsTable
        ? agentNativeSignupsConfigFingerprint(
            config.agentNativeSignups.eventsTable,
          )
        : null;
    case "youtube":
      return youtubeConfigFingerprint(config.youtube.channels);
    case "x":
      return xConfigFingerprint(config.x);
    case "builder_blog":
    case "signups":
      return null;
  }
}

export type ContentCollectionScope = {
  ownerEmail: string;
  orgId: string | null;
};

/** Same tenant keys the first-party rollup tables use. */
export function contentTenantKey(scope: ContentCollectionScope): string {
  return scope.orgId
    ? `org:${scope.orgId}`
    : `user:${scope.ownerEmail.trim().toLowerCase()}`;
}
