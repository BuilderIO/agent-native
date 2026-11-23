import type {
  AiUsageStatus,
  DataBrowserDetail,
  DataBrowserView,
  SourceFamily,
} from "@/components/data/data-page-model";
import type { DataResourceMetadataPatch } from "@/lib/model/data-resource-contracts";

/** Route segment for each source tab. */
export const DATA_BROWSER_ROUTE_TABS: Record<DataBrowserView, string> = {
  recommended: "recommended",
  all: "all",
  "semantic-layer": "semantic-layer",
  "recently-used": "recently-used",
  favorites: "favorites",
};

const DETAIL_TYPES = [
  "data-connection",
  "database",
  "schema",
  "table",
] as const;

const SCOPED_RESOURCE_PREFIX = "dsr1:";
const SCOPED_RESOURCE_KINDS = ["database", "schema", "table"] as const;

export type ScopedResourceKind = (typeof SCOPED_RESOURCE_KINDS)[number];

/** A node selection that keeps its owning connection in one path segment. */
export interface ScopedResourceRef {
  connectionId: string;
  kind: ScopedResourceKind;
  resourceId: string;
}

export type DataBrowserRouteDetail = DataBrowserDetail;

/**
 * One opaque, collision-safe route value for a node selection. The provider
 * resource id is preserved exactly; the connection is carried alongside it so
 * a reload can restore both without guessing. The prefix cannot collide with a
 * legacy provider id (`schema:...`, `table:...`).
 */
export function encodeScopedResourceId(ref: ScopedResourceRef): string {
  return `${SCOPED_RESOURCE_PREFIX}${encodeURIComponent(
    JSON.stringify([ref.connectionId, ref.kind, ref.resourceId]),
  )}`;
}

export function decodeScopedResourceId(
  value: string,
): ScopedResourceRef | undefined {
  if (!value.startsWith(SCOPED_RESOURCE_PREFIX)) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      decodeURIComponent(value.slice(SCOPED_RESOURCE_PREFIX.length)),
    );
    if (!Array.isArray(parsed) || parsed.length !== 3) return undefined;
    const [connectionId, kind, resourceId] = parsed;
    if (typeof connectionId !== "string" || !connectionId) return undefined;
    if (typeof resourceId !== "string" || !resourceId) return undefined;
    if (
      typeof kind !== "string" ||
      !(SCOPED_RESOURCE_KINDS as readonly string[]).includes(kind)
    ) {
      return undefined;
    }
    return {
      connectionId,
      kind: kind as ScopedResourceKind,
      resourceId,
    };
  } catch {
    return undefined;
  }
}

export function resolveDataBrowserView(
  tabParam: string | undefined,
): DataBrowserView {
  if (
    tabParam === "recommended" ||
    tabParam === "recently-used" ||
    tabParam === "favorites"
  ) {
    return tabParam;
  }
  return "all";
}

export function resolveDataBrowserDetail(
  detailViewType: string | undefined,
  dataSourceId: string | undefined,
): DataBrowserRouteDetail | undefined {
  if (!detailViewType || !dataSourceId) return undefined;
  if (detailViewType === "data-connection") {
    return { type: "data-connection", id: dataSourceId };
  }
  if (dataSourceId.startsWith(SCOPED_RESOURCE_PREFIX)) {
    const scoped = decodeScopedResourceId(dataSourceId);
    return scoped ? { type: scoped.kind, id: scoped.resourceId } : undefined;
  }
  if ((DETAIL_TYPES as readonly string[]).includes(detailViewType)) {
    return {
      type: detailViewType as (typeof DETAIL_TYPES)[number],
      id: dataSourceId,
    } as DataBrowserRouteDetail;
  }
  return undefined;
}

export function dataBrowserHref(
  view: DataBrowserView,
  detail?: DataBrowserDetail | undefined,
  scopedConnectionId?: string | undefined,
): string {
  const base = `/home/data/${DATA_BROWSER_ROUTE_TABS[view]}`;
  if (!detail) return base;
  const routeId =
    detail.type === "data-connection" || !scopedConnectionId
      ? detail.id
      : encodeScopedResourceId({
          connectionId: scopedConnectionId,
          kind: detail.type,
          resourceId: detail.id,
        });
  return `${base}/${detail.type}/${encodeURIComponent(routeId)}`;
}

/**
 * Display name from a known canonical provider id. It never exposes the scoped
 * route value; unknown shapes return undefined rather than a made-up name.
 */
export function providerResourceName(resourceId: string): string | undefined {
  const parts = resourceId.split(":");
  if (parts.length < 3) return undefined;
  const prefix = parts[0];
  if (prefix !== "database" && prefix !== "schema" && prefix !== "table") {
    return undefined;
  }
  const last = parts[parts.length - 1];
  if (!last) return undefined;
  try {
    return decodeURIComponent(last);
  } catch {
    return undefined;
  }
}

export function sourceFamiliesForConnections(
  connections: readonly { id: string; type: string }[],
): ReadonlyMap<string, SourceFamily> {
  // BigQuery exposes datasets as schemas; the component default is the same
  // verified schema family, so only the explicitly grounded provider is pinned.
  return new Map(
    connections
      .filter((connection) => connection.type === "bigquery")
      .map((connection) => [connection.id, "schemas" as const]),
  );
}

/**
 * The metadata action stores a nullable AI choice. A connection with no stored
 * override is excluded (the safe default); a resource with no override is not
 * placed in the map so the UI inherits the connection value.
 */
export function connectionAiUsage(
  aiUsage: AiUsageStatus | null | undefined,
): AiUsageStatus {
  return aiUsage ?? "excluded";
}

/**
 * The canonical connection DTO is authoritative when it carries an effective
 * AI value. A missing/unknown value falls through to the annotation default.
 */
export function canonicalConnectionAiUsage(
  connection: { aiUsage?: unknown } | undefined,
): AiUsageStatus | undefined {
  const value = connection?.aiUsage;
  return value === "included" || value === "excluded" ? value : undefined;
}

export function resourceAiUsage(
  resources: readonly {
    kind: string;
    id: string;
    aiUsage: AiUsageStatus | null;
  }[],
): ReadonlyMap<string, AiUsageStatus> {
  const map = new Map<string, AiUsageStatus>();
  for (const resource of resources) {
    if (resource.kind === "connection" || resource.aiUsage === null) continue;
    map.set(resource.id, resource.aiUsage);
  }
  return map;
}

export function categoryChangePatch(
  categoryId: string,
  added: boolean,
): DataResourceMetadataPatch {
  return { categoryChange: { categoryId, added } };
}
