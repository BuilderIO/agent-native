import { z } from "zod";

export const CONTENT_SIDEBAR_STATE_VERSION = 1;
export const CONTENT_SIDEBAR_STATE_SETTING_KEY = "content-sidebar-state";

const expandedIdSchema = z.string().min(1).max(256);

export const contentSidebarStateSchema = z.object({
  version: z.literal(CONTENT_SIDEBAR_STATE_VERSION),
  expandedWorkspaceIds: z.array(expandedIdSchema).max(1_000),
  expandedDocumentIds: z.array(expandedIdSchema).max(5_000),
});

export type ContentSidebarState = z.infer<typeof contentSidebarStateSchema>;

export function normalizeContentSidebarState(value: unknown) {
  const parsed = contentSidebarStateSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    expandedWorkspaceIds: [...new Set(parsed.data.expandedWorkspaceIds)],
    expandedDocumentIds: [...new Set(parsed.data.expandedDocumentIds)],
  };
}
