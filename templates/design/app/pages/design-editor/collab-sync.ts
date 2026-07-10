import { shouldUseLiveFileContent } from "@shared/html-content";

export function shouldRebaseCollabDocFromStoredContent({
  liveContent,
  storedContent,
  storedUpdatedAt,
  lastAppliedUpdatedAt,
  fileType,
}: {
  liveContent: string;
  storedContent: string;
  storedUpdatedAt: string | null | undefined;
  lastAppliedUpdatedAt: string | null;
  fileType: string;
}): boolean {
  if (liveContent === storedContent) return false;
  if (
    !shouldUseLiveFileContent({
      liveContent,
      storedContent,
      fileType,
    })
  ) {
    return true;
  }
  if (fileType.toLowerCase() !== "html") return false;
  if (!lastAppliedUpdatedAt) return !!storedUpdatedAt;
  return false;
}

export function resolveScreenCollabSyncTarget({
  fileId,
  overviewPresenceFileId,
  overviewDocConnected,
}: {
  fileId: string;
  overviewPresenceFileId: string | null;
  overviewDocConnected: boolean;
}): { writeLiveDoc: boolean; syncCollab: boolean } {
  const writeLiveDoc =
    overviewDocConnected && overviewPresenceFileId === fileId;
  return { writeLiveDoc, syncCollab: !writeLiveDoc };
}
