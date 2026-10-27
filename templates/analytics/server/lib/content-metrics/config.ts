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
  "search_console",
  "signups",
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

const bigQueryTableSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9_-]+.[A-Za-z0-9_]+.[A-Za-z0-9_]+$/,
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

export const contentCollectionConfigSchema = z.object({
  builderBlog: stepToggleSchema.default({ enabled: true }),
  ga4: ga4ConfigSchema.default({ enabled: true, propertyId: null }),
  // Off until a property owner grants the service account access; a run
  // before then would only record "no access".
  searchConsole: stepToggleSchema
    .extend({
      sites: z.array(storedSearchConsoleSiteSchema).max(20).default([]),
    })
    .default({ enabled: false, sites: [] }),
  signups: signupsConfigSchema.default({
    enabled: false,
    signupEventsTable: null,
    firstPageviewsTable: null,
    signupSource: null,
    signupsSince: null,
    maxBytesBilled: null,
  }),
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
    case "search_console":
      return config.searchConsole.enabled;
    case "signups":
      return config.signups.enabled;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function ga4ConfigFingerprint(propertyId: string): string {
  return sha256(propertyId);
}

export function searchConsoleConfigFingerprint(
  sites: ContentCollectionConfig["searchConsole"]["sites"],
): string {
  return sha256(
    JSON.stringify(
      sites.map((site) => [
        normalizeSearchConsoleProperty(site.siteUrl),
        site.pathPrefix?.trim() ?? "",
      ]),
    ),
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
      return config.ga4.propertyId
        ? ga4ConfigFingerprint(config.ga4.propertyId)
        : null;
    case "search_console":
      return searchConsoleConfigFingerprint(config.searchConsole.sites);
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
