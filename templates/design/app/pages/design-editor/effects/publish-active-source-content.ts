import { useLayoutEffect, useRef } from "react";
import type * as Y from "yjs";

export function usePublishActiveSourceContent({
  activeFile,
  activeContent,
  rawActiveContent,
  canEditDesign,
  canPersistDesignSource,
  isSynced,
  publishCanonicalContent,
  ydoc,
}: {
  activeFile: { id: string; fileType?: string } | null | undefined;
  activeContent: string;
  rawActiveContent: string;
  canEditDesign: boolean;
  canPersistDesignSource: boolean;
  isSynced: boolean;
  publishCanonicalContent: (
    fileId: string,
    sourceContent: string,
    fileType?: string,
  ) => string;
  ydoc: Y.Doc | null;
}): void {
  const sourcePersistenceDeniedRef = useRef(!canPersistDesignSource);
  useLayoutEffect(() => {
    const regained =
      canPersistDesignSource && sourcePersistenceDeniedRef.current;
    sourcePersistenceDeniedRef.current = !canPersistDesignSource;
    if (!activeFile?.id) return;
    // A synced screen's collab content is already canonical, so publishing it
    // finds nothing to persist; regained access must publish the doc's raw text.
    const syncedText =
      regained && ydoc && isSynced ? ydoc.getText("content").toJSON() : "";
    const sourceContent = syncedText || rawActiveContent;
    if (sourceContent !== activeContent)
      publishCanonicalContent(
        activeFile.id,
        sourceContent,
        activeFile.fileType,
      );
  }, [
    activeFile?.id,
    activeFile?.fileType,
    rawActiveContent,
    activeContent,
    publishCanonicalContent,
    canEditDesign,
    canPersistDesignSource,
    isSynced,
    ydoc,
  ]);
}
