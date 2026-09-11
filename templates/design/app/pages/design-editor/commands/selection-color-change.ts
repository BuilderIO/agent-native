import {
  replaceSelectionColorsInHtml,
  type SelectionColorScope,
} from "@/components/design/edit-panel/document-colors";
import type { StyleChangeMeta } from "@/components/design/edit-panel/style-change-types";

export interface SelectionColorChangeArgs {
  activeFileId: string | null | undefined;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      forcePreviewFullDocument?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
    },
  ) => void;
  canEditDesign: boolean;
  scopes: SelectionColorScope[];
}

export function runSelectionColorChange(
  args: SelectionColorChangeArgs,
  from: string,
  to: string,
  meta?: StyleChangeMeta,
) {
  if (!args.canEditDesign || !from.trim() || !to.trim()) return;
  const scopesByFile = new Map<string, SelectionColorScope[]>();
  args.scopes.forEach((scope) => {
    scopesByFile.set(scope.fileId, [
      ...(scopesByFile.get(scope.fileId) ?? []),
      scope,
    ]);
  });
  const previewOnly = meta?.phase === "preview";
  scopesByFile.forEach((scopes, fileId) => {
    const content = scopes[0]?.content;
    if (!content) return;
    const nextContent = replaceSelectionColorsInHtml(content, scopes, from, to);
    if (nextContent === content) {
      // A picker commit can repeat its final preview value. Still route that
      // value through the normal save/history path after the preview skipped it.
      if (!previewOnly) {
        args.applyFileContentUpdate(fileId, content, {
          forcePreviewFullDocument: fileId === args.activeFileId,
          persist: true,
          recordHistory: true,
        });
      }
      return;
    }
    args.applyFileContentUpdate(fileId, nextContent, {
      forcePreviewFullDocument: fileId === args.activeFileId,
      persist: !previewOnly,
      recordHistory: !previewOnly,
    });
  });
}
