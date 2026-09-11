import { callAction } from "@agent-native/core/client/hooks";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import { sanitizeLocalhostSourceSnapshotHtml } from "@/components/design/design-canvas/external-preview";
import type { LocalhostWriteConsentPayload } from "@/components/design/LocalhostWriteConsentDialog";
import {
  NO_LOCALHOST_CONNECTION_MESSAGE,
  NO_LOCALHOST_WRITE_CONTENT_MESSAGE,
  NO_LOCALHOST_WRITE_PATH_MESSAGE,
} from "@/pages/design-editor/editor-constants";
import { resolveLocalhostSourceWriteContent } from "@/pages/design-editor/editor-state";

export interface ApplyToSourceArgs {
  activeLocalhostConnectionId: string;
  activeLocalhostRelPath: string | undefined;
  activeLocalhostSourceSnapshotHtml: string | undefined;
  canEditDesign: boolean;
  id: string | undefined;
  latestActiveContentRef: RefObject<string | null>;
  requestLocalhostWrite: (opts: {
    files: string[];
    onGranted: LocalhostWriteConsentPayload["onGranted"];
    onCancel?: () => void;
  }) => void;
  setApplyToSourcePending: Dispatch<SetStateAction<boolean>>;
  stripEditorOnlyAttributes: (html: string) => string;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runApplyToSource({
  activeLocalhostConnectionId,
  activeLocalhostRelPath,
  activeLocalhostSourceSnapshotHtml,
  canEditDesign,
  id,
  latestActiveContentRef,
  requestLocalhostWrite,
  setApplyToSourcePending,
  stripEditorOnlyAttributes,
  t,
}: ApplyToSourceArgs) {
  if (!id || !canEditDesign) return;
  // VE7: surface why "Apply to source" can't proceed instead of silently
  // no-oping when the connection or the resolved source path is missing.
  if (!activeLocalhostConnectionId) {
    toast.error(NO_LOCALHOST_CONNECTION_MESSAGE);
    return;
  }
  if (!activeLocalhostRelPath) {
    toast.error(NO_LOCALHOST_WRITE_PATH_MESSAGE);
    return;
  }
  const relPath = activeLocalhostRelPath;
  const connectionId = activeLocalhostConnectionId;
  // URL-backed Design files persist the route URL in `content`; HTML source
  // comes from the authenticated snapshot model populated by DesignCanvas.
  // Fail closed until that source exists so this button can never serialize
  // a localhost URL and overwrite the user's actual file with it.
  const ext = (relPath.match(/\.[^.]+$/) ?? [])[0]?.toLowerCase() ?? "";
  const rawContent = resolveLocalhostSourceWriteContent({
    extension: ext,
    persistedContent: latestActiveContentRef.current,
    liveSnapshotHtml: activeLocalhostSourceSnapshotHtml,
  });
  if (!rawContent) {
    toast.error(NO_LOCALHOST_WRITE_CONTENT_MESSAGE);
    return;
  }
  // Strip editor-only attributes before writing so the on-disk file stays
  // clean.  Only strip for HTML routes; CSS files have no DOM attributes.
  const content =
    ext === ".html" || ext === ".htm"
      ? stripEditorOnlyAttributes(
          sanitizeLocalhostSourceSnapshotHtml(rawContent),
        )
      : rawContent;

  requestLocalhostWrite({
    files: [relPath],
    onGranted: () => {
      void (async () => {
        setApplyToSourcePending(true);
        try {
          // Read the file's current versionHash immediately before writing
          // so write-local-file can reject a concurrent on-disk edit. Never
          // downgrade to an unguarded overwrite when the read fails: the
          // semantic React path is agent-driven, and this legacy whole-file
          // path is intentionally limited to directly writable HTML/CSS.
          const readResult = (await callAction(
            "read-local-file",
            {
              designId: id,
              connectionId,
              path: relPath,
            },
            { method: "GET" },
          )) as { versionHash?: string } | undefined;
          const expectedVersionHash = readResult?.versionHash;
          if (!expectedVersionHash) {
            throw new Error(
              `Could not verify the current version of ${relPath}; no source was written.`,
            );
          }

          await callAction("write-local-file", {
            designId: id,
            connectionId,
            relPath,
            content,
            expectedVersionHash,
          });
          toast.success(t("designEditor.appliedToSource", { path: relPath }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("version conflict")) {
            toast.error(
              t("designEditor.applyToSourceConflict", { path: relPath }),
            );
          } else {
            toast.error(t("designEditor.applyToSourceError", { message }));
          }
        } finally {
          setApplyToSourcePending(false);
        }
      })();
    },
    onCancel: () => {
      setApplyToSourcePending(false);
    },
  });
}
