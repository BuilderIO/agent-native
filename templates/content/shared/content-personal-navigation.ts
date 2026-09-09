import { z } from "zod";

export const CONTENT_RECENT_LIMIT = 50;
export const contentSidebarSectionIdSchema = z.enum([
  "pinned",
  "recent",
  "workspaces",
]);
export type ContentSidebarSectionId = z.infer<
  typeof contentSidebarSectionIdSchema
>;
export const contentSidebarSectionsSchema = z.object({
  order: z
    .array(contentSidebarSectionIdSchema)
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
});
export type ContentSidebarSections = z.infer<
  typeof contentSidebarSectionsSchema
>;
export function defaultContentSidebarSections(): ContentSidebarSections {
  return {
    order: ["pinned", "recent", "workspaces"],
    pinned: { visible: true, expanded: true, limit: 5 },
    recent: { visible: true, expanded: true, limit: 5 },
  };
}

const identitySchema = z.string().min(1).max(256);
export const contentRecentTargetSchema = z
  .object({
    documentId: identitySchema,
    databaseId: identitySchema.optional(),
    viewId: identitySchema.optional(),
  })
  .refine((target) => !target.viewId || Boolean(target.databaseId));
export type ContentRecentTarget = z.infer<typeof contentRecentTargetSchema>;
export const contentRecentEntrySchema = z.object({
  target: contentRecentTargetSchema,
  visitedAt: z.string().datetime(),
});
export type ContentRecentEntry = z.infer<typeof contentRecentEntrySchema>;
export const contentRecentStateSchema = z.object({
  version: z.literal(1),
  entries: z.array(contentRecentEntrySchema).max(CONTENT_RECENT_LIMIT),
});
export type ContentRecentState = z.infer<typeof contentRecentStateSchema>;
export type ContentRecentResult = ContentRecentEntry & {
  title: string;
  icon: string | null;
  viewName: string | null;
};

export function contentRecentTargetKey(target: ContentRecentTarget) {
  return JSON.stringify([
    target.documentId,
    target.databaseId ?? null,
    target.viewId ?? null,
  ]);
}

export function readContentRecentState(value: unknown): ContentRecentState {
  if (value === null) return { version: 1, entries: [] };
  return contentRecentStateSchema.parse(value);
}

export function recordContentRecentVisit(
  state: ContentRecentState,
  entry: ContentRecentEntry,
): ContentRecentState {
  const key = contentRecentTargetKey(entry.target);
  const existing = state.entries.find(
    (candidate) => contentRecentTargetKey(candidate.target) === key,
  );
  if (existing && existing.visitedAt > entry.visitedAt) return state;
  return {
    version: 1,
    entries: [
      entry,
      ...state.entries.filter(
        (candidate) => contentRecentTargetKey(candidate.target) !== key,
      ),
    ]
      .sort((a, b) => b.visitedAt.localeCompare(a.visitedAt))
      .slice(0, CONTENT_RECENT_LIMIT),
  };
}

export function contentRecentHref(target: ContentRecentTarget) {
  const params = new URLSearchParams();
  if (target.databaseId) params.set("databaseId", target.databaseId);
  if (target.viewId) params.set("viewId", target.viewId);
  const query = params.toString();
  return `/page/${encodeURIComponent(target.documentId)}${query ? `?${query}` : ""}`;
}
