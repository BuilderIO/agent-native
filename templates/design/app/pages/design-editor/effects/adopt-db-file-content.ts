import { shouldUseLiveFileContent } from "@shared/html-content";
import { sourceContentHash } from "@shared/source-workspace";
import type { Dispatch, RefObject, SetStateAction } from "react";
import * as Y from "yjs";

import {
  TAB_ID,
  shouldAdoptExternalReconcileContent,
} from "@/pages/design-editor/editor-session";
import type { PreviewContentReplaceResult } from "@/pages/design-editor/editor-state";
import { previewContentReplaceNeedsRenderFallback } from "@/pages/design-editor/editor-state";
import type { ContentHistoryChange } from "@/pages/design-editor/history";
import type { DesignFile } from "@/pages/design-editor/types";

export interface AdoptDbFileContentArgs {
  activeFile: DesignFile;
  agentActive: boolean;
  clearStaleAgentCollabRecovery: () => void;
  collabContent: string | null;
  collabContentFileId: string | null;
  collabContentFileIdRef: RefObject<string | null>;
  collabContentRef: RefObject<string | null>;
  documentFileContentRef: RefObject<string | null>;
  documentFileUpdatedAtRef: RefObject<string | null>;
  isLeadClient: boolean;
  isSynced: boolean;
  lastAckedFileContentHashRef: RefObject<Record<string, string>>;
  lastAppliedFileUpdatedAtRef: RefObject<string | null>;
  lastLocalContentRef: RefObject<string | null>;
  latestActiveContentRef: RefObject<string | null>;
  recordExternalContentHistoryCheckpoint: (
    change: ContentHistoryChange,
  ) => void;
  replacePreviewContent: (
    nextContent: string,
    selector?: string | null,
    options?: { forceFullDocument?: boolean },
  ) => PreviewContentReplaceResult;
  setCollabContent: Dispatch<SetStateAction<string | null>>;
  setCollabContentFileId: Dispatch<SetStateAction<string | null>>;
  setContentRenderRevision: Dispatch<SetStateAction<number>>;
  staleAgentCollabRecoveryTimerRef: RefObject<number | null>;
  undoManagerRef: RefObject<Y.UndoManager | null>;
  ydoc: Y.Doc | null;
}

export function runAdoptDbFileContent({
  activeFile,
  agentActive,
  clearStaleAgentCollabRecovery,
  collabContent,
  collabContentFileId,
  collabContentFileIdRef,
  collabContentRef,
  documentFileContentRef,
  documentFileUpdatedAtRef,
  isLeadClient,
  isSynced,
  lastAckedFileContentHashRef,
  lastAppliedFileUpdatedAtRef,
  lastLocalContentRef,
  latestActiveContentRef,
  recordExternalContentHistoryCheckpoint,
  replacePreviewContent,
  setCollabContent,
  setCollabContentFileId,
  setContentRenderRevision,
  staleAgentCollabRecoveryTimerRef,
  undoManagerRef,
  ydoc,
}: AdoptDbFileContentArgs) {
  if (!activeFile || !isSynced) return;
  const dbContent = activeFile.content ?? "";
  const dbUpdatedAt = activeFile.updatedAt ?? null;
  const activeScopedCollabContent =
    collabContentFileId === activeFile.id ? collabContent : null;
  if (
    typeof activeScopedCollabContent === "string" &&
    !shouldUseLiveFileContent({
      liveContent: activeScopedCollabContent,
      storedContent: dbContent,
      fileType: activeFile.fileType,
    })
  ) {
    clearStaleAgentCollabRecovery();
    setCollabContent(dbContent);
    setCollabContentFileId(activeFile.id);
    lastLocalContentRef.current = dbContent;
    latestActiveContentRef.current = dbContent;
    lastAckedFileContentHashRef.current[activeFile.id] =
      sourceContentHash(dbContent);
    if (dbUpdatedAt) lastAppliedFileUpdatedAtRef.current = dbUpdatedAt;
    if (
      previewContentReplaceNeedsRenderFallback(
        replacePreviewContent(dbContent, null, {
          forceFullDocument: true,
        }),
      )
    ) {
      setContentRenderRevision((revision) => revision + 1);
    }

    if (isLeadClient && ydoc) {
      const ytext = ydoc.getText("content");
      if (ytext.toString() !== dbContent) {
        // Untracked full rewrite (agent edit / external DB content
        // replacing a live doc that diverged) — clear the undo stack so a
        // stale tracked delta can't be replayed against content it no
        // longer matches (see U1: this is the primary corruption path —
        // agent edits, motion autosave, and id-stamping all land here).
        undoManagerRef.current?.clear(true, false);
        ydoc.transact(() => {
          ytext.delete(0, ytext.length);
          ytext.insert(0, dbContent);
        }, TAB_ID);
      }
    }
    return;
  }

  // Already reflecting this exact content (our own echo or Yjs already
  // delivered it) — just advance the watermark and stop.
  if (
    activeScopedCollabContent === dbContent ||
    lastLocalContentRef.current === dbContent
  ) {
    if (dbUpdatedAt) lastAppliedFileUpdatedAtRef.current = dbUpdatedAt;
    return;
  }

  // Only adopt genuinely newer content. No baseline yet (fresh file load)
  // always adopts so a stale persisted Y.Doc can't shadow newer SQL. See
  // shouldAdoptExternalReconcileContent's doc comment
  // (design-editor/editor-session.ts) for the same-millisecond tie-break
  // fix this closes: a strict `>` used to silently drop a real external
  // write that landed in the same millisecond as the one already applied,
  // whenever agentActive was false.
  const applied = lastAppliedFileUpdatedAtRef.current;
  const externalNewer = shouldAdoptExternalReconcileContent({
    appliedUpdatedAt: applied,
    dbUpdatedAt,
    agentActive,
  });
  const staleAgentEchoPossible =
    agentActive &&
    !!applied &&
    !!dbUpdatedAt &&
    dbUpdatedAt === applied &&
    lastLocalContentRef.current !== activeScopedCollabContent;
  if (!externalNewer) {
    if (staleAgentEchoPossible) {
      if (staleAgentCollabRecoveryTimerRef.current === null) {
        const expectedContent = dbContent;
        const expectedUpdatedAt = dbUpdatedAt;
        const expectedFileId = activeFile.id;
        staleAgentCollabRecoveryTimerRef.current = window.setTimeout(() => {
          staleAgentCollabRecoveryTimerRef.current = null;
          const currentCollab = collabContentRef.current;
          if (collabContentFileIdRef.current !== expectedFileId) return;
          if (documentFileUpdatedAtRef.current !== expectedUpdatedAt) return;
          if (documentFileContentRef.current !== expectedContent) return;
          if (currentCollab === expectedContent) return;
          if (lastLocalContentRef.current === currentCollab) return;

          setCollabContent(expectedContent);
          setCollabContentFileId(expectedFileId);
          lastLocalContentRef.current = expectedContent;
          latestActiveContentRef.current = expectedContent;
          lastAckedFileContentHashRef.current[expectedFileId] =
            sourceContentHash(expectedContent);
          lastAppliedFileUpdatedAtRef.current = expectedUpdatedAt;
          if (
            previewContentReplaceNeedsRenderFallback(
              replacePreviewContent(expectedContent, null, {
                forceFullDocument: true,
              }),
            )
          ) {
            setContentRenderRevision((revision) => revision + 1);
          }

          if (isLeadClient && ydoc) {
            const ytext = ydoc.getText("content");
            if (ytext.toString() !== expectedContent) {
              // Untracked full rewrite — see U1 note above.
              undoManagerRef.current?.clear(true, false);
              ydoc.transact(() => {
                ytext.delete(0, ytext.length);
                ytext.insert(0, expectedContent);
              }, TAB_ID);
            }
          }
        }, 1200);
      }
    } else {
      clearStaleAgentCollabRecovery();
    }
    return;
  }
  clearStaleAgentCollabRecovery();

  // U21: this whole effect exists BECAUSE the Yjs observe path (which
  // already checkpoints agent edits into the local undo fallback, see U3
  // above at the ytext.observe handler) can miss the update — same-tab
  // background, a paused collab poll, or no collab session ever
  // established for this viewer. Every branch below used to respond to
  // that exact case by clearing the undo manager with nothing to fall back
  // to, so Cmd+Z after an agent-driven full-content replacement that
  // landed via THIS path had nothing left to restore — the reported
  // "pressed cmd+z but unable to change it back", reproduced end-to-end:
  // an `edit-design`/`update-file` write (mode=replace-file) lands purely
  // through `writeInlineSourceFile`'s SQL write, never through the Yjs
  // collab broadcast that the U3 checkpoint above depends on to learn
  // `agentActive` — so gating this path on the SAME `agentActive` flag
  // (sourced from `useCollaborativeDoc`'s Yjs `requestSource === "agent"`
  // signal) would almost never fire here, since the very reason a change
  // lands on THIS path instead of the Yjs-observe path is that no matching
  // Yjs broadcast arrived to flip that flag. Unlike the Yjs-observe site
  // (which can distinguish an agent transaction from a human peer's by
  // origin), this path cannot reliably tell "agent" from "another human
  // editing the same design without a live collab session" apart — but
  // recording a local undo checkpoint either way is still correct and
  // safe: it only affects what THIS viewer's Cmd+Z reverts to, never what
  // gets written back to any other collaborator.
  const previousActiveContentForCheckpoint = latestActiveContentRef.current;
  if (
    typeof previousActiveContentForCheckpoint === "string" &&
    previousActiveContentForCheckpoint !== dbContent
  ) {
    recordExternalContentHistoryCheckpoint({
      fileId: activeFile.id,
      before: previousActiveContentForCheckpoint,
      after: dbContent,
    });
  }

  // Render the newer content immediately so the preview is never stale.
  setCollabContent(dbContent);
  setCollabContentFileId(activeFile.id);
  lastLocalContentRef.current = dbContent;
  latestActiveContentRef.current = dbContent;
  lastAckedFileContentHashRef.current[activeFile.id] =
    sourceContentHash(dbContent);
  if (dbUpdatedAt) lastAppliedFileUpdatedAtRef.current = dbUpdatedAt;
  if (
    previewContentReplaceNeedsRenderFallback(
      replacePreviewContent(dbContent, null, { forceFullDocument: true }),
    )
  ) {
    setContentRenderRevision((revision) => revision + 1);
  }

  // Lead client mirrors it into the shared Y.Doc so other open clients
  // receive it through Yjs and the durable collab state stays in step. The
  // agent's update-file/generate-design already wrote the Y.Doc in-process,
  // so in the common case this is a no-op diff; it only does real work when
  // the Yjs update was missed (the failure this fallback exists to cover).
  if (isLeadClient && ydoc) {
    const ytext = ydoc.getText("content");
    if (ytext.toString() !== dbContent) {
      // Untracked full rewrite — see U1 note above. The view-appropriate
      // checkpoint recorded above (U21) is what Cmd+Z now falls back to.
      undoManagerRef.current?.clear(true, false);
      ydoc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, dbContent);
      }, TAB_ID);
    }
  }
}
