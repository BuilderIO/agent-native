import { AddLocalhostScreenDialog } from "@/components/design/AddLocalhostScreenDialog";
import { LocalhostWriteConsentSurface } from "@/components/design/LocalhostWriteConsentDialog";
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
  const { localhostWriteConsent } = editorActiveScreenAndGeometry;
  const {
    addLocalhostScreenOpen,
    setAddLocalhostScreenOpen,
    addLocalhostScreenFallbackPaths,
  } = editorLayerActions;

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
          persist an edit to a local source file and no valid grant exists for
          that connection yet. */}
      {id ? (
        <LocalhostWriteConsentSurface
          designId={id}
          consent={localhostWriteConsent}
        />
      ) : null}
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
