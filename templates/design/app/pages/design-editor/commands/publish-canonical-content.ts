import { sourceContentHash } from "@shared/source-workspace";
import type { RefObject } from "react";

import type { PendingLocalFileContent } from "../editor-state";
import { prepareCanonicalSourceContent } from "../source-publication";

export function runPublishCanonicalContent(
  args: {
    canEditDesignRef: RefObject<boolean>;
    pendingLocalFileContentsRef: RefObject<
      Map<string, PendingLocalFileContent>
    >;
    cancelIdentityMigration: (fileId: string) => void;
    queueFileContentSave: (
      fileId: string,
      content: string,
      options: {
        expectedVersionHash: string;
        syncCollab: boolean;
        immediate: boolean;
        identityMigrationSourceContent: string;
      },
    ) => void;
  },
  fileId: string,
  sourceContent: string,
  fileType: string = "html",
): string {
  const prepared = prepareCanonicalSourceContent(sourceContent, {
    fileId,
    fileType,
  });
  const pending = args.pendingLocalFileContentsRef.current.get(fileId);
  if (
    pending?.identityMigrationSourceContent !== undefined &&
    sourceContent !== pending.content &&
    sourceContent !== pending.identityMigrationSourceContent
  ) {
    args.cancelIdentityMigration(fileId);
  }
  const current = args.pendingLocalFileContentsRef.current.get(fileId);
  if (current && current.identityMigrationSourceContent === undefined)
    return current.content;
  if (!prepared.changed || !args.canEditDesignRef.current)
    return prepared.content;
  if (
    current?.content === prepared.content &&
    current.identityMigrationSourceContent === sourceContent
  )
    return prepared.content;
  args.queueFileContentSave(fileId, prepared.content, {
    expectedVersionHash: sourceContentHash(sourceContent),
    syncCollab: true,
    immediate: true,
    identityMigrationSourceContent: sourceContent,
  });
  return prepared.content;
}
