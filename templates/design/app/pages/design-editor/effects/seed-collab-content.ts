import type { Dispatch, RefObject, SetStateAction } from "react";
import * as Y from "yjs";

import {
  shouldRebaseCollabDocFromStoredContent,
  writeCollabText,
} from "@/pages/design-editor/collab-sync";
import { TAB_ID } from "@/pages/design-editor/editor-session";
import type {
  PendingLocalFileContent,
  PreviewContentReplaceResult,
} from "@/pages/design-editor/editor-state";
import { previewContentReplaceNeedsRenderFallback } from "@/pages/design-editor/editor-state";
import type { DesignFile } from "@/pages/design-editor/types";

import { prepareCanonicalSourceContent } from "../source-publication";

export interface SeedCollabContentArgs {
  publishCanonicalContent: (
    fileId: string,
    sourceContent: string,
    fileType?: string,
  ) => string;
  activeFile: DesignFile;
  activeFileId: string | null;
  collabContentFileIdRef: RefObject<string | null>;
  isSynced: boolean;
  lastAppliedFileContentRef: RefObject<string | null>;
  lastAppliedFileUpdatedAtRef: RefObject<string | null>;
  lastLocalContentRef: RefObject<string | null>;
  latestActiveContentRef: RefObject<string | null>;
  pendingLocalFileContentsRef: RefObject<Map<string, PendingLocalFileContent>>;
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
  publishCanonicalContent,
  activeFileId,
  collabContentFileIdRef,
  isSynced,
  lastAppliedFileContentRef,
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
  const text = ytext.toJSON();
  const pending = pendingLocalFileContentsRef.current.get(fileId);
  const pendingLocalContent = pending?.content;
  if (
    pendingLocalContent &&
    pending.identityMigrationSourceContent === undefined
  ) {
    if (text !== pendingLocalContent) {
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
      // Untracked origin: the UndoManager only tracks LOCAL_EDIT_ORIGIN, so
      // this write is invisible to it. Clear the undo stack so a subsequent
      // Cmd+Z can't replay a tracked delta from before it against content it
      // no longer matches (see the DE:5135-style mitigation below for the
      // same hazard).
      undoManagerRef.current?.clear(true, false);
      writeCollabText(ydoc, ytext, pendingLocalContent, TAB_ID);
    } else {
      setCollabContent(pendingLocalContent);
      setCollabContentFileId(fileId);
      lastLocalContentRef.current = pendingLocalContent;
      latestActiveContentRef.current = pendingLocalContent;
    }
    return;
  }
  if (text.length > 0) {
    const storedSourceContent = activeFile?.content ?? "";
    const storedContent = prepareCanonicalSourceContent(storedSourceContent, {
      fileId,
      fileType: activeFile?.fileType,
    }).content;
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
      const acceptedStoredContent = publishCanonicalContent(
        fileId,
        storedSourceContent,
        activeFile?.fileType,
      );
      setCollabContent(acceptedStoredContent);
      setCollabContentFileId(fileId);
      lastLocalContentRef.current = acceptedStoredContent;
      latestActiveContentRef.current = acceptedStoredContent;
      if (activeFile?.updatedAt) {
        lastAppliedFileUpdatedAtRef.current = activeFile.updatedAt;
        lastAppliedFileContentRef.current = storedSourceContent;
      }
      if (
        previewContentReplaceNeedsRenderFallback(
          replacePreviewContent(acceptedStoredContent, null, {
            forceFullDocument: true,
          }),
        )
      ) {
        setContentRenderRevision((revision) => revision + 1);
      }
      // Untracked write — see clear() note above.
      undoManagerRef.current?.clear(true, false);
      writeCollabText(ydoc, ytext, acceptedStoredContent, TAB_ID);
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
    const canonicalLiveContent = prepareCanonicalSourceContent(text, {
      fileId,
      fileType: activeFile?.fileType,
    }).content;
    const hasPendingIdentityMigration =
      pending?.identityMigrationSourceContent !== undefined;
    if (
      canonicalLiveContent !== latestActiveContentRef.current ||
      collabContentFileIdRef.current !== fileId ||
      hasPendingIdentityMigration
    ) {
      const shouldRefreshPreview =
        canonicalLiveContent !== latestActiveContentRef.current ||
        collabContentFileIdRef.current !== fileId;
      const canonical = publishCanonicalContent(
        fileId,
        text,
        activeFile?.fileType,
      );
      setCollabContent(canonical);
      setCollabContentFileId(fileId);
      latestActiveContentRef.current = canonical;
      if (
        shouldRefreshPreview &&
        previewContentReplaceNeedsRenderFallback(
          replacePreviewContent(canonical, null, { forceFullDocument: true }),
        )
      ) {
        setContentRenderRevision((revision) => revision + 1);
      }
    }
  }
}
