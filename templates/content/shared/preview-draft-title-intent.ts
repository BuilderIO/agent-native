export function previewDraftTitleIntent(
  draft: { title: string; baseTitle?: string | null },
  reviewedTitle: string,
) {
  if (draft.baseTitle == null) return { status: "unknown" as const };
  const changesTitle = draft.title !== draft.baseTitle;
  return {
    status: "known" as const,
    changesTitle,
    title: changesTitle ? draft.title : reviewedTitle,
  };
}
