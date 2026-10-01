import { useRef } from "react";

import { prepareCanonicalSourceContent } from "../source-publication";

export function syncLatestActiveContentFromRender(args: {
  activeContent: string;
  activeFile: { id: string; fileType?: string | null } | null | undefined;
  latestActiveContentRef: { current: string | null };
  pendingLocalFileContents: ReadonlyMap<string, { content: string }>;
}): void {
  const { activeFile } = args;
  if (!activeFile?.id) {
    args.latestActiveContentRef.current = args.activeContent;
    return;
  }
  const pendingContent = args.pendingLocalFileContents.get(
    activeFile.id,
  )?.content;
  args.latestActiveContentRef.current = prepareCanonicalSourceContent(
    pendingContent ?? args.activeContent,
    { fileId: activeFile.id, fileType: activeFile.fileType },
  ).content;
}

/**
 * Syncs `latestActiveContentRef` while rendering, whenever the rendered active
 * content changes. Screens read the ref during the same render, so syncing in
 * an effect leaves a collaborator's saved content one render behind and the
 * screen keeps showing this tab's last edit until something else re-renders.
 */
export function useSyncLatestActiveContent(
  args: Parameters<typeof syncLatestActiveContentFromRender>[0],
): void {
  const syncedRef = useRef<{
    content: string;
    fileId?: string;
    fileType?: string | null;
  } | null>(null);
  const synced = syncedRef.current;
  const { activeContent, activeFile } = args;
  if (
    synced &&
    synced.content === activeContent &&
    synced.fileId === activeFile?.id &&
    synced.fileType === activeFile?.fileType
  ) {
    return;
  }
  syncedRef.current = {
    content: activeContent,
    fileId: activeFile?.id,
    fileType: activeFile?.fileType,
  };
  syncLatestActiveContentFromRender(args);
}
