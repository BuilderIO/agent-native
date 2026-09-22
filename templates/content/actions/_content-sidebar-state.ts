import { z } from "zod";

import { contentSidebarSectionsSchema } from "../shared/content-personal-navigation.js";

export const CONTENT_SIDEBAR_STATE_VERSION = 2;
export const CONTENT_SIDEBAR_STATE_SETTING_KEY = "content-sidebar-state";

export function contentSidebarStateSettingKey(spaceId?: string) {
  return spaceId
    ? `${CONTENT_SIDEBAR_STATE_SETTING_KEY}:${spaceId}`
    : CONTENT_SIDEBAR_STATE_SETTING_KEY;
}

const expandedIdSchema = z.string().min(1).max(256);

const contentSidebarStateV1Schema = z.object({
  version: z.literal(1),
  expandedWorkspaceIds: z.array(expandedIdSchema).max(1_000).optional(),
  expandedDocumentIds: z.array(expandedIdSchema).max(5_000).optional(),
  sections: z
    .object({
      order: z
        .array(z.enum(["pinned", "recent", "workspaces"]))
        .length(3)
        .refine((ids) => new Set(ids).size === 3),
      pinned: z.object({
        visible: z.boolean(),
        expanded: z.boolean(),
        limit: z.number().int().min(5).max(50),
      }),
      recent: z.object({
        visible: z.boolean(),
        expanded: z.boolean(),
        limit: z.number().int().min(5).max(50),
      }),
    })
    .optional(),
});

export const contentSidebarStateSchema = z.object({
  version: z.literal(CONTENT_SIDEBAR_STATE_VERSION),
  expandedWorkspaceIds: z.array(expandedIdSchema).max(1_000).optional(),
  expandedDocumentIds: z.array(expandedIdSchema).max(5_000).optional(),
  sections: contentSidebarSectionsSchema.optional(),
});

export type ContentSidebarState = z.infer<typeof contentSidebarStateSchema>;

export function normalizeContentSidebarState(
  value: unknown,
  selectedSpaceId?: string,
) {
  if (value === null) return null;
  const current = contentSidebarStateSchema.safeParse(value);
  const data = current.success
    ? current.data
    : migrateContentSidebarState(
        contentSidebarStateV1Schema.parse(value),
        selectedSpaceId,
      );
  return {
    ...data,
    ...(data.expandedWorkspaceIds === undefined
      ? {}
      : { expandedWorkspaceIds: [...new Set(data.expandedWorkspaceIds)] }),
    ...(data.expandedDocumentIds === undefined
      ? {}
      : { expandedDocumentIds: [...new Set(data.expandedDocumentIds)] }),
  };
}

function migrateContentSidebarState(
  state: z.infer<typeof contentSidebarStateV1Schema>,
  selectedSpaceId?: string,
): ContentSidebarState {
  const sections = state.sections;
  return {
    version: CONTENT_SIDEBAR_STATE_VERSION,
    ...(state.expandedWorkspaceIds === undefined
      ? {}
      : { expandedWorkspaceIds: state.expandedWorkspaceIds }),
    ...(state.expandedDocumentIds === undefined
      ? {}
      : { expandedDocumentIds: state.expandedDocumentIds }),
    ...(sections
      ? {
          sections: {
            order: sections.order.map((id) =>
              id === "workspaces" ? "files" : id,
            ),
            pinned: {
              visible: sections.pinned.visible,
              expanded: sections.pinned.expanded,
            },
            recent: {
              visible: sections.recent.visible,
              expanded: sections.recent.expanded,
            },
            files: {
              visible: true,
              expanded:
                state.expandedWorkspaceIds === undefined ||
                (selectedSpaceId
                  ? state.expandedWorkspaceIds.includes(selectedSpaceId)
                  : state.expandedWorkspaceIds.length > 0),
            },
          },
        }
      : {}),
  };
}
