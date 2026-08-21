import type { Dispatch, RefObject, SetStateAction } from "react";
import * as Y from "yjs";

import { shouldRebaseCollabDocFromStoredContent } from "@/pages/design-editor/collab-sync";
import { TAB_ID } from "@/pages/design-editor/editor-session";
import type { PreviewContentReplaceResult } from "@/pages/design-editor/editor-state";
import { previewContentReplaceNeedsRenderFallback } from "@/pages/design-editor/editor-state";
import type { DesignFile } from "@/pages/design-editor/types";

export interface SeedCollabContentArgs {
  activeFile: DesignFile;
  activeFileId: string | null;
  collabContentFileIdRef: RefObject<string | null>;
  isSynced: boolean;
  lastAppliedFileUpdatedAtRef: RefObject<string | null>;
  lastLocalContentRef: RefObject<string | null>;
  latestActiveContentRef: RefObject<string | null>;
  pendingLocalFileContentsRef: RefObject<
    Map<
      string,
      { content: string; startedAt: number; baseUpdatedAt?: string | null }
    >
  >;
  replacePreviewContent: (
    nextContent: string,
    selector?: string | null,
    options?: { forceFullDocument?: boolean },
  ) => PreviewContentReplaceResult;
  setCollabContent: Dispatch<SetStateAction<string | null>>;
  setCollabContentFileId: Dispatch<SetStateAction<string | null>>;
  setContentRenderRevision: Dispatch<SetStateAction<number>>;
  undoManagerRef: RefObject<Y.UndoManager | null>;
  ydoc: Y.Doc | null;
}

export function runSeedCollabContent({
  activeFile,
  activeFileId,
  collabContentFileIdRef,
  isSynced,
  lastAppliedFileUpdatedAtRef,
  lastLocalContentRef,
  latestActiveContentRef,
  pendingLocalFileContentsRef,
  replacePreviewContent,
  setCollabContent,
  setCollabContentFileId,
  setContentRenderRevision,
  undoManagerRef,
  ydoc,
}: SeedCollabContentArgs) {
  if (!ydoc || !isSynced || !activeFileId) return;
  const fileId = activeFileId;
  const ytext = ydoc.getText("content");
  const text = ytext.toString();
  const pendingLocalContent =
    pendingLocalFileContentsRef.current.get(fileId)?.content;
  if (pendingLocalContent && text !== pendingLocalContent) {
    setCollabContent(pendingLocalContent);
    setCollabContentFileId(fileId);
    lastLocalContentRef.current = pendingLocalContent;
    latestActiveContentRef.current = pendingLocalContent;
    if (
      previewContentReplaceNeedsRenderFallback(
        replacePreviewContent(pendingLocalContent, null, {
          forceFullDocument: true,
        }),
      )
    ) {
      setContentRenderRevision((revision) => revision + 1);
    }
    // Full delete+insert with an untracked origin: the UndoManager only
    // tracks LOCAL_EDIT_ORIGIN, so this rewrite is invisible to it. Clear
    // the undo stack so a subsequent Cmd+Z can't replay a tracked delta
    // from before this rewrite against content it no longer matches
    // (see the DE:5135-style mitigation below for the same hazard).
    undoManagerRef.current?.clear(true, false);
    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, pendingLocalContent);
    }, TAB_ID);
    return;
  }
  if (text.length > 0) {
    const storedContent = activeFile?.content ?? "";
    // §gesture-persistence — a freshly-connected/just-synced doc snapshot
    // has no proven watermark yet in this session. Don't let it outrank
    // SQL merely because it looks like well-formed HTML: rebase from SQL
    // whenever they differ and no baseline has been established (or the
    // live text is outright malformed). See
    // shouldRebaseCollabDocFromStoredContent's doc comment for the full
    // clobber this closes.
    if (
      shouldRebaseCollabDocFromStoredContent({
        liveContent: text,
        storedContent,
        storedUpdatedAt: activeFile?.updatedAt ?? null,
        lastAppliedUpdatedAt: lastAppliedFileUpdatedAtRef.current,
        fileType: activeFile?.fileType ?? "html",
      })
    ) {
      setCollabContent(storedContent);
      setCollabContentFileId(fileId);
      lastLocalContentRef.current = storedContent;
      latestActiveContentRef.current = storedContent;
      if (activeFile?.updatedAt) {
        lastAppliedFileUpdatedAtRef.current = activeFile.updatedAt;
      }
      if (
        previewContentReplaceNeedsRenderFallback(
          replacePreviewContent(storedContent, null, {
            forceFullDocument: true,
          }),
        )
      ) {
        setContentRenderRevision((revision) => revision + 1);
      }
      // Untracked full rewrite — see clear() note above.
      undoManagerRef.current?.clear(true, false);
      ydoc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, storedContent);
      }, TAB_ID);
      return;
    }
    // Y.Doc snapshots are a render seed, not the SQL source of truth; the
    // reconcile effect below advances the updatedAt watermark only after it
    // confirms or applies the current DB content.
    //
    // Item 5 (edit-flash) root cause: this effect's deps include
    // `activeFile?.content`/`activeFile?.updatedAt`, which change on EVERY
    // save (useActionMutation's default onSuccess invalidates all
    // `["action"]` queries, so `get-design` refetches after every single
    // edit and hands back a new `activeFile` object with a bumped
    // `updatedAt`). That refire lands here even when the Y.Doc's `text`
    // hasn't changed at all since the last time this ran — previously this
    // unconditionally re-adopted `text` and bumped contentRenderRevision on
    // every such refire, forcing a full srcdoc rebuild after nearly every
    // commit. Only touch collab/render state when `text` genuinely differs
    // from what is already reflected.
    if (
      text !== latestActiveContentRef.current ||
      collabContentFileIdRef.current !== fileId
    ) {
      setCollabContent(text);
      setCollabContentFileId(fileId);
      latestActiveContentRef.current = text;
      if (
        previewContentReplaceNeedsRenderFallback(
          replacePreviewContent(text, null, { forceFullDocument: true }),
        )
      ) {
        setContentRenderRevision((revision) => revision + 1);
      }
    }
  }
}
