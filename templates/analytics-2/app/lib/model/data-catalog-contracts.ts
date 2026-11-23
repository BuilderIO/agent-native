import { z } from "zod";

/**
 * Shared shapes for the saved, browsable catalog of a workspace data
 * connection. The catalog is a bounded copy of the provider's public
 * top-level schema resources, so these shapes deliberately contain no
 * connection config, credential reference or provider payload: there is no
 * field for one to travel in.
 *
 * The saved snapshot covers top-level schemas only (`scope`). A schema's
 * tables are read from the provider through the existing cursor loader, so a
 * count here is a count of schemas and never a claim about their children.
 */
export const DATA_CATALOG_SCOPE = "root-schemas" as const;
export type DataCatalogScope = typeof DATA_CATALOG_SCOPE;

/** The browser asks for one of these; the action allows up to a page of 1000. */
export const DATA_CATALOG_DEFAULT_PAGE = 50;
export const DATA_CATALOG_MAX_PAGE = 1000;
/** The provider seam accepts at most this many items per request. */
export const DATA_CATALOG_REFRESH_PAGE_SIZE = 1000;

export const dataCatalogResourceSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: z.enum(["database", "schema", "table"]),
  hasChildren: z.boolean().optional(),
});
export type DataCatalogResource = z.infer<typeof dataCatalogResourceSchema>;

/**
 * `never` means no snapshot has been saved yet. `refreshing` means a refresh
 * owns the snapshot and may still fail; the previously saved resources stay
 * readable during that time. `failed` keeps the last successful resources.
 */
export const dataCatalogRefreshStateSchema = z.enum([
  "never",
  "refreshing",
  "ready",
  "failed",
  // The saved rows describe a source configuration that is no longer the
  // connection's current one, so they are not presented as current names.
  "stale",
]);
export type DataCatalogRefreshState = z.infer<
  typeof dataCatalogRefreshStateSchema
>;

export const dataCatalogErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});
export type DataCatalogError = z.infer<typeof dataCatalogErrorSchema>;

export const dataCatalogProgressSchema = z.object({
  collectedCount: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
});
export type DataCatalogProgress = z.infer<typeof dataCatalogProgressSchema>;

export const getDataBrowserCatalogSchema = z
  .object({
    connectionId: z.string().min(1).max(200),
    /**
     * Accepted so a caller cannot be silently ignored: a non-empty parent is
     * outside this snapshot and is refused explicitly. Table drilldown uses
     * the existing provider-backed dataset loader.
     */
    parentId: z.string().max(1000).optional(),
    search: z.string().max(200).optional(),
    first: z
      .number()
      .int()
      .min(1)
      .max(DATA_CATALOG_MAX_PAGE)
      .default(DATA_CATALOG_DEFAULT_PAGE),
    after: z.string().max(16384).optional(),
  })
  .strict();

export type GetDataBrowserCatalogInput = z.infer<
  typeof getDataBrowserCatalogSchema
>;

/**
 * `totalCount` counts every resource in the saved catalog that matches the
 * current search filter, not only the resources on this page. `resources`
 * carries just this page.
 */
export const dataBrowserCatalogOutputSchema = z.object({
  connectionId: z.string(),
  /** Safe identity for a single source's first-cache bootstrap. */
  bootstrapKey: z.string().min(1),
  scope: z.literal(DATA_CATALOG_SCOPE),
  resources: z.array(dataCatalogResourceSchema),
  totalCount: z.number().int().nonnegative(),
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
  refreshState: dataCatalogRefreshStateSchema,
  hasSuccessfulSnapshot: z.boolean(),
  /** Opaque saved-row generation; clients discard cursors when this changes. */
  revision: z.string().nullable(),
  lastRefreshed: z.string().nullable(),
  refreshError: dataCatalogErrorSchema.nullable(),
  refreshProgress: dataCatalogProgressSchema.nullable(),
  // A `refreshing` lease whose heartbeat is older than the lock window. GET is
  // read-only and reports this instead of taking over or clearing the lease.
  refreshStale: z.boolean(),
});

export type DataBrowserCatalog = z.infer<typeof dataBrowserCatalogOutputSchema>;

export const refreshDataBrowserCatalogSchema = z
  .object({
    connectionId: z.string().min(1).max(200),
    revision: z.string().min(1).max(200).optional(),
  })
  .strict();

export type RefreshDataBrowserCatalogInput = z.infer<
  typeof refreshDataBrowserCatalogSchema
>;

/** The refresh action reports the state that is saved after it settles. */
export const dataCatalogRefreshOutputSchema = z.object({
  connectionId: z.string(),
  refreshState: dataCatalogRefreshStateSchema,
  lastRefreshed: z.string().nullable(),
  refreshError: dataCatalogErrorSchema.nullable(),
  refreshProgress: dataCatalogProgressSchema.nullable(),
  refreshStale: z.boolean(),
  totalCount: z.number().int().nonnegative(),
});

export type DataCatalogRefreshResult = z.infer<
  typeof dataCatalogRefreshOutputSchema
>;
