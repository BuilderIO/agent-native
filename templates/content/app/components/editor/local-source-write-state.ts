export interface PendingLocalSourceWrite {
  title: string;
  content: string;
}

export type LocalSourceReadDisposition =
  | "pending-self-write"
  | "conflict"
  | "external-change"
  | "unchanged";

export function localSourceRevisionForSave(
  queuedRevision: string | null | undefined,
  currentRevision: string | undefined,
) {
  return queuedRevision === undefined ? currentRevision : queuedRevision;
}

export function localSourceRevisionForQueuedEdit(
  pendingRevision: string | null | undefined,
  currentRevision: string | undefined,
) {
  return pendingRevision === undefined
    ? (currentRevision ?? null)
    : pendingRevision;
}

export function classifyLocalSourceRead(args: {
  diskTitle: string;
  diskContent: string;
  localContent: string;
  lastSavedTitle: string;
  lastSavedContent: string;
  pendingWrite: PendingLocalSourceWrite | null;
  hasPendingSave?: boolean;
}): LocalSourceReadDisposition {
  if (
    args.pendingWrite?.title === args.diskTitle &&
    args.pendingWrite.content === args.diskContent
  ) {
    return "pending-self-write";
  }

  const hasUnsavedEdit =
    args.hasPendingSave === true || args.localContent !== args.lastSavedContent;
  const diskChanged =
    args.diskContent !== args.lastSavedContent ||
    args.diskTitle !== args.lastSavedTitle;

  if (hasUnsavedEdit && diskChanged) return "conflict";
  return diskChanged ? "external-change" : "unchanged";
}
