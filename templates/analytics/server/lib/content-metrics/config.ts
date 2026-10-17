import { z } from "zod";

import {
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
] as const;
export type ContentCollectionStepId = (typeof CONTENT_COLLECTION_STEPS)[number];

const stepToggleSchema = z.object({ enabled: z.boolean() });

/**
 * A Search Console property: `sc-domain:example.com` or a URL-prefix
 * property such as `https://www.example.com/`. `pathPrefix` keeps a large
 * site to the pages the Content view tracks.
 */
export const searchConsoleSiteSchema = z.object({
  siteUrl: z
    .string()
    .trim()
    .min(1)
    .superRefine((siteUrl, ctx) => {
      const problem = searchConsolePropertyProblem(siteUrl);
      if (problem) {
        ctx.addIssue({
          code: "custom",
          message: searchConsolePropertyMessage(siteUrl, problem),
        });
      }
    }),
  pathPrefix: z.string().trim().startsWith("/").optional(),
});
export type SearchConsoleSite = z.infer<typeof searchConsoleSiteSchema>;

export const contentCollectionConfigSchema = z.object({
  builderBlog: stepToggleSchema.default({ enabled: true }),
  ga4: stepToggleSchema.default({ enabled: true }),
  // Off until a property owner grants the service account access; a run
  // before then would only record "no access".
  searchConsole: stepToggleSchema
    .extend({ sites: z.array(searchConsoleSiteSchema).max(20).default([]) })
    .default({ enabled: false, sites: [] }),
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
