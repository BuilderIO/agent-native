import { z } from "zod";

import { contentSidebarSectionsSchema } from "../shared/content-personal-navigation.js";

export const CONTENT_SIDEBAR_STATE_VERSION = 1;
export const CONTENT_SIDEBAR_STATE_SETTING_KEY = "content-sidebar-state";

const expandedIdSchema = z.string().min(1).max(256);

export const contentSidebarStateSchema = z.object({
  version: z.literal(CONTENT_SIDEBAR_STATE_VERSION),
  expandedWorkspaceIds: z.array(expandedIdSchema).max(1_000).optional(),
  expandedDocumentIds: z.array(expandedIdSchema).max(5_000).optional(),
  sections: contentSidebarSectionsSchema.optional(),
});

export type ContentSidebarState = z.infer<typeof contentSidebarStateSchema>;

export function normalizeContentSidebarState(value: unknown) {
  if (value === null) return null;
  const data = contentSidebarStateSchema.parse(value);
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
