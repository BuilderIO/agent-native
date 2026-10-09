import { AddLocalhostScreenDialog } from "@/components/design/AddLocalhostScreenDialog";
import { LocalhostWriteConsentDialog } from "@/components/design/LocalhostWriteConsentDialog";
import { NodeRewriteProposal as NodeRewriteProposalPanel } from "@/components/visual-editor/NodeRewriteProposal";

import type { NodeRewriteProposal } from "../../../../shared/node-rewrite";
import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorFilesAndSaving } from "../domains/use-editor-files-and-saving";
import type { EditorLayerActions } from "../domains/use-editor-layer-actions";
import type { EditorSourceAndSync } from "../domains/use-editor-source-and-sync";

export function renderNodeRewriteAndLocalhostDialogs({
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorLayerActions,
  editorSourceAndSync,
  id,
  activeNodeRewriteProposal,
  addLocalhostScreenConnectionId,
}: {
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorLayerActions: EditorLayerActions;
  editorSourceAndSync: EditorSourceAndSync;
  id: string;
  activeNodeRewriteProposal: NodeRewriteProposal | null;
  addLocalhostScreenConnectionId: string | undefined;
}) {
  const { addLocalhostScreenPosition } = editorFilesAndSaving;
  const {
    localhostConsentConnectionId,
    localhostWriteConsentOpen,
    localhostWriteConsentPayload,
    setLocalhostWriteConsentPayload,
    setLocalhostWriteConsentOpen,
  } = editorActiveScreenAndGeometry;
  const {
    addLocalhostScreenOpen,
    setAddLocalhostScreenOpen,
    addLocalhostScreenFallbackPaths,
  } = editorLayerActions;
  const { activeLocalhostConnectionId } = editorSourceAndSync;

  return (
    <>
      {id && activeNodeRewriteProposal ? (
        <NodeRewriteProposalPanel
          designId={id}
          fileId={activeNodeRewriteProposal.fileId}
          canvasSelector='[data-node-rewrite-canvas-target="true"]'
          proposalSnapshot={activeNodeRewriteProposal}
        />
      ) : null}

      {/* Localhost write-consent dialog: shown when the agent or editor wants to
          persist an edit to a local HTML/CSS source file and no valid grant
          exists for the active connection yet. */}
      {id && (activeLocalhostConnectionId || localhostConsentConnectionId) && (
        <LocalhostWriteConsentDialog
          open={localhostWriteConsentOpen}
          onOpenChange={(next) => {
            if (!next) {
              localhostWriteConsentPayload?.onCancel();
              setLocalhostWriteConsentPayload(null);
            }
            setLocalhostWriteConsentOpen(next);
          }}
          designId={id}
          connectionId={localhostConsentConnectionId}
          payload={localhostWriteConsentPayload}
        />
      )}
      {id ? (
        <AddLocalhostScreenDialog
          open={addLocalhostScreenOpen}
          onOpenChange={setAddLocalhostScreenOpen}
          designId={id}
          connectionId={addLocalhostScreenConnectionId}
          fallbackPaths={addLocalhostScreenFallbackPaths}
          position={addLocalhostScreenPosition}
        />
      ) : null}
    </>
  );
}
