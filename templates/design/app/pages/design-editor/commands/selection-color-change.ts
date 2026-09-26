import {
  replaceSelectionFillColorsInHtml,
  replaceSelectionColorsInHtml,
  type SelectionColorScope,
} from "@/components/design/edit-panel/document-colors";
import type { StyleChangeMeta } from "@/components/design/edit-panel/style-change-types";

import type { ContentHistoryEntry } from "../history";
import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";

export interface SelectionColorPreviewHistoryEntry {
  before: string;
  after: string;
  from?: string;
  scopeIdentity?: string;
  invalidated?: boolean;
}

export interface SelectionColorPickerSessionEntry {
  before?: string;
  expected?: string;
  from: string;
  scopeIdentity: string;
  invalidated?: boolean;
}

export interface SelectionColorChangeArgs {
  activeFileId: string | null | undefined;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      forcePreviewFullDocument?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      historyBeforeContent?: string;
    },
  ) => void;
  canEditDesign: boolean;
  recordContentHistoryEntry: (entry: ContentHistoryEntry) => void;
  previewHistoryRef: {
    current: Map<string, SelectionColorPreviewHistoryEntry>;
  };
  pickerSessionRef: {
    current: Map<string, SelectionColorPickerSessionEntry>;
  };
  scopes: SelectionColorScope[];
}

export function restoreSelectionColorPreview(
  args: Pick<SelectionColorChangeArgs, "activeFileId" | "previewHistoryRef"> & {
    applyFileContentUpdate: (
      ...args: Parameters<SelectionColorChangeArgs["applyFileContentUpdate"]>
    ) => ApplyFileContentUpdateResult;
  },
  fileId: string,
  content: string | undefined,
): ApplyFileContentUpdateResult["status"] | "stale" {
  const preview = args.previewHistoryRef.current.get(fileId);
  if (!preview || content === undefined || preview.after !== content) {
    args.previewHistoryRef.current.delete(fileId);
    return "stale";
  }
  if (preview.before !== content) {
    const result = args.applyFileContentUpdate(fileId, preview.before, {
      forcePreviewFullDocument: fileId === args.activeFileId,
      persist: false,
      recordHistory: false,
    });
    if (result.status !== "accepted") return result.status;
  }
  args.previewHistoryRef.current.delete(fileId);
  return "accepted";
}

export type SelectionColorChangeResult =
  | { status: "applied" }
  | { status: "ignored" }
  | { status: "refused" };

function scopeIdentityFor(scopes: SelectionColorScope[]): string {
  return JSON.stringify(
    scopes.map(({ fileId, sourceId, selector, wholeDocument }) => ({
      fileId,
      sourceId,
      selector,
      wholeDocument,
    })),
  );
}

export function setSelectionColorPickerSession(
  args: Pick<
    SelectionColorChangeArgs,
    "pickerSessionRef" | "previewHistoryRef" | "scopes"
  >,
  from: string,
  open: boolean,
): void {
  if (!open) {
    args.pickerSessionRef.current.clear();
    for (const [fileId, preview] of args.previewHistoryRef.current) {
      if (preview.from !== undefined) {
        args.previewHistoryRef.current.delete(fileId);
      }
    }
    return;
  }

  const scopesByFile = new Map<string, SelectionColorScope[]>();
  args.scopes.forEach((scope) => {
    scopesByFile.set(scope.fileId, [
      ...(scopesByFile.get(scope.fileId) ?? []),
      scope,
    ]);
  });
  for (const [fileId, scopes] of scopesByFile) {
    args.pickerSessionRef.current.set(fileId, {
      from,
      scopeIdentity: scopeIdentityFor(scopes),
    });
  }
}

export function runSelectionColorChange(
  args: SelectionColorChangeArgs,
  from: string,
  to: string,
  meta?: StyleChangeMeta,
  mode: "all-colors" | "fill-colors" = "all-colors",
): SelectionColorChangeResult {
  if (!args.canEditDesign) return { status: "ignored" };
  if (args.scopes.length === 0) return { status: "ignored" };
  const scopesByFile = new Map<string, SelectionColorScope[]>();
  args.scopes.forEach((scope) => {
    scopesByFile.set(scope.fileId, [
      ...(scopesByFile.get(scope.fileId) ?? []),
      scope,
    ]);
  });
  if (meta?.phase === "cancel") {
    let stale = false;
    for (const [fileId, scopes] of scopesByFile) {
      const content = scopes[0]?.content;
      if (
        content === undefined ||
        scopes.some((scope) => scope.content !== content)
      ) {
        stale = true;
        continue;
      }
      const identity = scopeIdentityFor(scopes);
      const session = args.pickerSessionRef.current.get(fileId);
      const preview = args.previewHistoryRef.current.get(fileId);
      if (
        session?.invalidated ||
        (session &&
          (session.scopeIdentity !== identity ||
            (session.expected !== undefined &&
              session.expected !== content))) ||
        (preview?.from !== undefined &&
          (preview.scopeIdentity !== identity || preview.after !== content))
      ) {
        if (session) {
          args.pickerSessionRef.current.set(fileId, {
            ...session,
            invalidated: true,
          });
        }
        args.previewHistoryRef.current.delete(fileId);
        stale = true;
        continue;
      }
      if (preview?.from !== undefined && preview.before !== content) {
        args.applyFileContentUpdate(fileId, preview.before, {
          forcePreviewFullDocument: fileId === args.activeFileId,
          persist: false,
          recordHistory: false,
        });
        if (session) {
          args.pickerSessionRef.current.set(fileId, {
            ...session,
            expected: preview.before,
          });
        }
      }
      args.previewHistoryRef.current.delete(fileId);
    }
    return stale ? { status: "refused" } : { status: "applied" };
  }
  if (!from.trim() || !to.trim()) return { status: "ignored" };
  const previewOnly = meta?.phase === "preview";
  const staleFileIds = new Set<string>();
  const plannedUpdates: Array<{
    content: string;
    fileId: string;
    historyBeforeContent: string | undefined;
    nextContent: string;
    previewBaseline: SelectionColorPreviewHistoryEntry | undefined;
    pickerSession: SelectionColorPickerSessionEntry | undefined;
    scopeIdentity: string;
  }> = [];

  for (const [fileId, scopes] of scopesByFile) {
    const content = scopes[0]?.content;
    if (
      content === undefined ||
      scopes.some((scope) => scope.content !== content)
    ) {
      return { status: "refused" };
    }
    const previousPreview = args.previewHistoryRef.current.get(fileId);
    const scopeIdentity = scopeIdentityFor(scopes);
    const currentSession = args.pickerSessionRef.current.get(fileId);
    if (previousPreview?.invalidated || currentSession?.invalidated) {
      staleFileIds.add(fileId);
      continue;
    }
    if (
      currentSession &&
      (currentSession.scopeIdentity !== scopeIdentity ||
        (currentSession.from !== from && currentSession.before !== undefined) ||
        (currentSession.expected !== undefined &&
          currentSession.expected !== content))
    ) {
      staleFileIds.add(fileId);
      continue;
    }
    const hasSelectionPreview =
      previousPreview?.from !== undefined &&
      previousPreview.scopeIdentity !== undefined;
    if (
      hasSelectionPreview &&
      (previousPreview.scopeIdentity !== scopeIdentity ||
        previousPreview.after !== content)
    ) {
      staleFileIds.add(fileId);
      continue;
    }
    const previewBaseline = hasSelectionPreview ? previousPreview : undefined;
    const pickerSession = currentSession
      ? {
          ...currentSession,
          before: currentSession.before ?? content,
          expected: currentSession.expected ?? content,
        }
      : previewOnly
        ? {
            before: content,
            expected: content,
            from,
            scopeIdentity,
          }
        : undefined;
    const historyBeforeContent = previewOnly
      ? undefined
      : previewBaseline?.before;
    const replacementContent = pickerSession?.before ?? content;
    const replacementScopes = pickerSession
      ? scopes.map((scope) => ({ ...scope, content: replacementContent }))
      : scopes;
    const sourceColor = pickerSession?.from ?? previewBaseline?.from ?? from;
    const nextContent =
      mode === "fill-colors"
        ? replaceSelectionFillColorsInHtml(
            replacementContent,
            replacementScopes,
            sourceColor,
            to,
          )
        : replaceSelectionColorsInHtml(
            replacementContent,
            replacementScopes,
            sourceColor,
            to,
          );
    if (nextContent === null) return { status: "refused" };
    plannedUpdates.push({
      content,
      fileId,
      historyBeforeContent,
      nextContent,
      previewBaseline,
      pickerSession,
      scopeIdentity,
    });
  }

  if (staleFileIds.size > 0) {
    for (const fileId of scopesByFile.keys()) {
      const preview = args.previewHistoryRef.current.get(fileId);
      const session = args.pickerSessionRef.current.get(fileId);
      if (session) {
        args.pickerSessionRef.current.set(fileId, {
          ...session,
          invalidated: true,
        });
      }
      if (!preview?.from) continue;
      if (previewOnly) {
        args.previewHistoryRef.current.set(fileId, {
          ...preview,
          invalidated: true,
        });
      } else {
        args.previewHistoryRef.current.delete(fileId);
      }
    }
    return { status: "refused" };
  }

  const groupedHistoryChanges =
    !previewOnly && plannedUpdates.length > 1
      ? plannedUpdates.flatMap(
          ({ content, fileId, historyBeforeContent, nextContent }) => {
            const before = historyBeforeContent ?? content;
            return before === nextContent
              ? []
              : [{ fileId, before, after: nextContent }];
          },
        )
      : undefined;

  for (const {
    content,
    fileId,
    historyBeforeContent,
    nextContent,
    previewBaseline,
    pickerSession,
    scopeIdentity,
  } of plannedUpdates) {
    if (nextContent === content) {
      if (!previewOnly) {
        args.applyFileContentUpdate(fileId, content, {
          forcePreviewFullDocument: fileId === args.activeFileId,
          persist: true,
          recordHistory: groupedHistoryChanges === undefined,
          ...(historyBeforeContent !== undefined
            ? { historyBeforeContent }
            : {}),
        });
      }
      if (pickerSession) {
        args.pickerSessionRef.current.set(fileId, {
          ...pickerSession,
          expected: nextContent,
        });
      }
      if (!previewOnly) args.previewHistoryRef.current.delete(fileId);
      continue;
    }
    if (previewOnly) {
      args.previewHistoryRef.current.set(fileId, {
        before: previewBaseline?.before ?? content,
        after: nextContent,
        from: pickerSession?.from ?? previewBaseline?.from ?? from,
        scopeIdentity,
      });
    }
    args.applyFileContentUpdate(fileId, nextContent, {
      forcePreviewFullDocument: fileId === args.activeFileId,
      persist: !previewOnly,
      recordHistory: !previewOnly && groupedHistoryChanges === undefined,
      ...(!previewOnly && historyBeforeContent !== undefined
        ? { historyBeforeContent }
        : {}),
    });
    if (pickerSession) {
      args.pickerSessionRef.current.set(fileId, {
        ...pickerSession,
        expected: nextContent,
      });
    }
    if (!previewOnly) args.previewHistoryRef.current.delete(fileId);
  }
  if (groupedHistoryChanges && groupedHistoryChanges.length > 0) {
    args.recordContentHistoryEntry({ changes: groupedHistoryChanges });
  }
  return { status: "applied" };
}
