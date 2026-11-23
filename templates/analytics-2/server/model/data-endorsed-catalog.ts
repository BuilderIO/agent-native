import { fail } from "@agent-native/core/action";
import { z } from "zod";

import type { DataResourceMetadata } from "../../app/lib/model/data-resource-contracts.js";
import {
  currentWorkspaceCapabilities,
  requireCurrentWorkspace,
} from "../lib/workspace-access.js";
import { listDataConnections } from "./data-connections.js";
import { listDataFavorites } from "./data-favorites.js";
import {
  readDataCategories,
  readDataResourceMetadata,
} from "./data-resource-metadata.js";
import { resourcePolicies } from "./data-resource-policy.js";
import { listStatuses } from "./statuses-store.js";

export const ENDORSED_CATALOG_ITEM_TYPES = [
  "view",
  "model",
  "table",
  "schema",
] as const;

export type EndorsedCatalogItemType =
  (typeof ENDORSED_CATALOG_ITEM_TYPES)[number];

export const endorsedCatalogItemSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  resourceId: z.string(),
  resourceKind: z.enum(["database", "schema", "table"]),
  group: z.enum(ENDORSED_CATALOG_ITEM_TYPES),
  name: z.string(),
  description: z.string(),
  pinned: z.boolean(),
  status: z.object({ id: z.string(), name: z.string() }),
  categories: z.array(z.object({ id: z.string(), name: z.string() })),
  connection: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
  }),
});

export type EndorsedCatalogItem = z.infer<typeof endorsedCatalogItemSchema>;

export const endorsedCatalogOutputSchema = z.object({
  itemTypes: z.tuple([
    z.literal("view"),
    z.literal("model"),
    z.literal("table"),
    z.literal("schema"),
  ]),
  groups: z.object({
    view: z.array(endorsedCatalogItemSchema),
    model: z.array(endorsedCatalogItemSchema),
    table: z.array(endorsedCatalogItemSchema),
    schema: z.array(endorsedCatalogItemSchema),
  }),
  items: z.array(endorsedCatalogItemSchema),
  statuses: z.array(z.object({ id: z.string(), name: z.string() })),
  categories: z.array(z.object({ id: z.string(), name: z.string() })),
});

export type EndorsedCatalogOutput = z.infer<typeof endorsedCatalogOutputSchema>;

function extractResourceName(resourceId: string): string {
  const parts = resourceId.split(":");
  const last = parts[parts.length - 1];
  if (!last) return resourceId;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function catalogGroupForResource(
  resource: DataResourceMetadata,
): EndorsedCatalogItemType | null {
  if (resource.kind === "schema" || resource.kind === "database") {
    return "schema";
  }
  if (resource.kind === "table") {
    return "table";
  }
  return null;
}

export async function listDataEndorsedCatalog(
  caller?: string,
): Promise<EndorsedCatalogOutput> {
  const current = await requireCurrentWorkspace();
  const capabilities = await currentWorkspaceCapabilities(current);
  if (!capabilities.allows("context-studio")) {
    fail("You do not have access to the data browser.", {
      statusCode: 403,
      errorCode: "data_endorsed_catalog_access_denied",
    });
  }

  const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
  const forAgent = caller !== "frontend";
  const [connections, statuses, categoryList, favoritesResult] =
    await Promise.all([
      listDataConnections({ forAgent }),
      listStatuses(scope),
      readDataCategories(scope),
      listDataFavorites(caller),
    ]);

  const endorsedStatuses = statuses.filter((status) => status.endorsed);
  const statusById = new Map(
    endorsedStatuses.map((status) => [
      status.id,
      { id: status.id, name: status.name },
    ]),
  );
  const categoryById = new Map(
    categoryList.categories.map((category) => [
      category.id,
      { id: category.id, name: category.name },
    ]),
  );
  const favoriteKeys = new Set(
    favoritesResult.favorites.map(
      (fav) => `${fav.connectionId}\u0000${fav.tableId}`,
    ),
  );

  const groups: Record<EndorsedCatalogItemType, EndorsedCatalogItem[]> = {
    view: [],
    model: [],
    table: [],
    schema: [],
  };

  const readableConnections = connections.filter((conn) => !conn.isDraft);

  if (statusById.size > 0 && readableConnections.length > 0) {
    const perConnection = await Promise.all(
      readableConnections.map(async (connection) => {
        const list = await readDataResourceMetadata(scope, connection.id);
        const endorsedResources = list.resources.filter(
          (resource) =>
            resource.statusId !== null && statusById.has(resource.statusId),
        );
        if (endorsedResources.length === 0) return [];
        if (!forAgent) {
          return endorsedResources.map((resource) => ({
            connection,
            resource,
          }));
        }
        const policy = await resourcePolicies(
          scope,
          connection.id,
          endorsedResources,
          "included",
          { bypassCache: true },
        );
        return endorsedResources
          .filter(
            (resource) =>
              policy.get(`${resource.kind}:${resource.id}`) === "included",
          )
          .map((resource) => ({ connection, resource }));
      }),
    );

    for (const entries of perConnection) {
      for (const { connection, resource } of entries) {
        const group = catalogGroupForResource(resource);
        if (!group || resource.kind === "connection" || !resource.statusId) {
          continue;
        }
        const status = statusById.get(resource.statusId);
        if (!status) continue;
        const item: EndorsedCatalogItem = {
          id: `${connection.id}:${resource.kind}:${resource.id}`,
          connectionId: connection.id,
          resourceId: resource.id,
          resourceKind: resource.kind,
          group,
          name: extractResourceName(resource.id),
          description: resource.description,
          pinned: favoriteKeys.has(`${connection.id}\u0000${resource.id}`),
          status,
          categories: resource.categoryIds
            .map((categoryId) => categoryById.get(categoryId))
            .filter(
              (entry): entry is { id: string; name: string } =>
                entry !== undefined,
            ),
          connection: {
            id: connection.id,
            name: connection.name,
            type: connection.type,
          },
        };
        groups[group].push(item);
      }
    }
  }

  for (const key of ENDORSED_CATALOG_ITEM_TYPES) {
    groups[key].sort((a, b) => a.name.localeCompare(b.name));
  }

  const items = [
    ...groups.view,
    ...groups.model,
    ...groups.table,
    ...groups.schema,
  ];

  return endorsedCatalogOutputSchema.parse({
    itemTypes: ["view", "model", "table", "schema"],
    groups,
    items,
    statuses: endorsedStatuses.map((status) => ({
      id: status.id,
      name: status.name,
    })),
    categories: categoryList.categories.map((category) => ({
      id: category.id,
      name: category.name,
    })),
  });
}
