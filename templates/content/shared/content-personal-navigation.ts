import { z } from "zod";

export const CONTENT_RECENT_LIMIT = 50;
export const contentSidebarSectionIdSchema = z.enum([
  "pinned",
  "recent",
  "files",
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
  }),
  recent: z.object({
    visible: z.boolean(),
    expanded: z.boolean(),
  }),
  files: z.object({
    visible: z.literal(true),
    expanded: z.boolean(),
  }),
});
export type ContentSidebarSections = z.infer<
  typeof contentSidebarSectionsSchema
>;
export function defaultContentSidebarSections(): ContentSidebarSections {
  return {
    order: ["pinned", "recent", "files"],
    pinned: { visible: true, expanded: true },
    recent: { visible: true, expanded: true },
    files: { visible: true, expanded: true },
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
const contentRecentStateV1Schema = z.object({
  version: z.literal(1),
  entries: z.array(contentRecentEntrySchema),
});
export const contentRecentStateSchema = z.object({
  version: z.literal(2),
  entries: z.array(contentRecentEntrySchema).max(CONTENT_RECENT_LIMIT),
});
export type ContentRecentState = z.infer<typeof contentRecentStateSchema>;
export type ContentRecentResult = ContentRecentEntry & {
  title: string;
  icon: string | null;
  viewName: string | null;
  fallback?: { reason: "saved_view_unavailable"; requestedViewId: string };
  isFavorite?: boolean;
};

export function contentRecentTargetKey(target: ContentRecentTarget) {
  return target.databaseId
    ? JSON.stringify(["database", target.databaseId])
    : JSON.stringify(["document", target.documentId]);
}

export function contentRecentVisitKey(target: ContentRecentTarget) {
  return JSON.stringify([
    target.documentId,
    target.databaseId ?? null,
    target.viewId ?? null,
  ]);
}

export function readContentRecentState(value: unknown): ContentRecentState {
  if (value === null) return { version: 2, entries: [] };
  const current = contentRecentStateSchema.safeParse(value);
  if (current.success) return current.data;
  const legacy = contentRecentStateV1Schema.parse(value);
  return migrateContentRecentState(legacy.entries);
}

function migrateContentRecentState(
  entries: ContentRecentEntry[],
): ContentRecentState {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        b.entry.visitedAt.localeCompare(a.entry.visitedAt) || a.index - b.index,
    )
    .reduce<ContentRecentState>(
      (state, { entry }) => recordContentRecentVisit(state, entry),
      { version: 2, entries: [] },
    );
}

export function recordContentRecentVisit(
  state: ContentRecentState,
  entry: ContentRecentEntry,
): ContentRecentState {
  const key = contentRecentTargetKey(entry.target);
  const existing = state.entries.find(
    (candidate) => contentRecentTargetKey(candidate.target) === key,
  );
  if (existing && existing.visitedAt >= entry.visitedAt) return state;
  return {
    version: 2,
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

export function removeContentRecentEntry(
  state: ContentRecentState,
  target: ContentRecentTarget,
): ContentRecentState {
  const key = contentRecentTargetKey(target);
  const entries = state.entries.filter(
    (candidate) => contentRecentTargetKey(candidate.target) !== key,
  );
  return entries.length === state.entries.length
    ? state
    : { version: 2, entries };
}

export function contentRecentHref(target: ContentRecentTarget) {
  const params = new URLSearchParams();
  if (target.databaseId) params.set("databaseId", target.databaseId);
  if (target.viewId) params.set("viewId", target.viewId);
  const query = params.toString();
  return `/page/${encodeURIComponent(target.documentId)}${query ? `?${query}` : ""}`;
}
