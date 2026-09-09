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
      .object({
        viewId: idSchema,
        mode: z.enum(["custom", "last_edited", "name", "created"]),
        itemIds: z.array(idSchema).max(5_000),
      })
      .optional(),
  })
  .refine(
    (patch) =>
      patch.activeViewId !== undefined || patch.sidebarOrder !== undefined,
  );
export type ContentPersonalNavigationPatch = z.infer<
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
  const { viewId, ...sidebarOrder } = patch.sidebarOrder;
  const previous = next.views.find((view) => view.id === viewId);
  const query = previous ?? sharedViews.find((view) => view.id === viewId);
  if (!query) throw new Error("Shared View query is unavailable.");
  const view = {
    id: viewId,
    sorts: query.sorts,
    filters: query.filters,
    filterMode: query.filterMode ?? "and",
    ...previous,
    sidebarOrder: {
      ...sidebarOrder,
      itemIds: [...new Set(sidebarOrder.itemIds)],
    },
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
