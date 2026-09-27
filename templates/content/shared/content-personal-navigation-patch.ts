import { z } from "zod";

import {
  CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
  type ContentDatabasePersonalViewOverrides,
  type ContentDatabaseView,
} from "./api.js";

const idSchema = z.string().min(1).max(256);
export const contentPersonalNavigationPatchSchema = z
  .object({
    activeViewId: idSchema.optional(),
    sidebarOrder: z
      .discriminatedUnion("operation", [
        z.object({
          operation: z.literal("replace").optional().default("replace"),
          viewId: idSchema,
          mode: z.enum(["custom", "last_edited", "name", "created"]),
          itemIds: z.array(idSchema).max(5_000),
        }),
        z.object({
          operation: z.enum(["prepend", "remove"]),
          viewId: idSchema,
          itemId: idSchema,
        }),
        z.object({
          operation: z.literal("reorder-subset"),
          viewId: idSchema,
          itemIds: z.array(idSchema).min(1).max(5_000),
          previousItemIds: z.array(idSchema).min(1).max(5_000),
        }),
      ])
      .optional(),
  })
  .refine(
    (patch) =>
      patch.activeViewId !== undefined || patch.sidebarOrder !== undefined,
  );
export type ContentPersonalNavigationPatch = z.input<
  typeof contentPersonalNavigationPatchSchema
>;

export function applyContentPersonalNavigationPatch(
  current: ContentDatabasePersonalViewOverrides | null,
  patch: ContentPersonalNavigationPatch,
  sharedViews: ReadonlyArray<
    Pick<ContentDatabaseView, "id" | "sorts" | "filters" | "filterMode">
  > = [],
): ContentDatabasePersonalViewOverrides {
  const next = current ?? {
    version: CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
    views: [],
  };
  if (!patch.sidebarOrder)
    return { ...next, activeViewId: patch.activeViewId ?? next.activeViewId };
  const sidebarPatch = patch.sidebarOrder;
  const { viewId } = sidebarPatch;
  const previous = next.views.find((view) => view.id === viewId);
  const query = previous ?? sharedViews.find((view) => view.id === viewId);
  if (!query) throw new Error("Shared View query is unavailable.");
  const previousOrder = previous?.sidebarOrder ?? {
    mode: "custom" as const,
    itemIds: [],
  };
  let sidebarOrder;
  if (sidebarPatch.operation === "reorder-subset") {
    const desired = [...new Set(sidebarPatch.itemIds)];
    const previous = [...new Set(sidebarPatch.previousItemIds)];
    if (
      desired.length !== previous.length ||
      desired.some((id) => !previous.includes(id))
    ) {
      throw new Error("Reordered items must match the loaded subset.");
    }
    const subset = new Set(previous);
    const baseOrder = [
      ...previousOrder.itemIds,
      ...previous.filter((id) => !previousOrder.itemIds.includes(id)),
    ];
    let index = 0;
    sidebarOrder = {
      ...previousOrder,
      mode: "custom" as const,
      itemIds: baseOrder.map((id) => (subset.has(id) ? desired[index++]! : id)),
    };
  } else {
    sidebarOrder =
      "itemId" in sidebarPatch && sidebarPatch.operation === "prepend"
        ? {
            ...previousOrder,
            itemIds: previousOrder.itemIds.includes(sidebarPatch.itemId)
              ? previousOrder.itemIds
              : [sidebarPatch.itemId, ...previousOrder.itemIds],
          }
        : "itemId" in sidebarPatch
          ? {
              ...previousOrder,
              itemIds: previousOrder.itemIds.filter(
                (id) => id !== sidebarPatch.itemId,
              ),
            }
          : {
              mode: sidebarPatch.mode,
              itemIds: [...new Set(sidebarPatch.itemIds)],
            };
  }
  const view = {
    id: viewId,
    sorts: query.sorts,
    filters: query.filters,
    filterMode: query.filterMode ?? "and",
    ...previous,
    sidebarOrder,
  };
  return {
    ...next,
    activeViewId: patch.activeViewId ?? next.activeViewId,
    views: previous
      ? next.views.map((candidate) =>
          candidate.id === viewId ? view : candidate,
        )
      : [...next.views, view],
  };
}
