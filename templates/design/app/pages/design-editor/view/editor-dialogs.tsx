import { AutoLayoutSuggestionDialog } from "@/components/design/AutoLayoutSuggestionDialog";
import { PendingVisualStyleWarningDialog } from "@/components/design/editor/PendingVisualStyleWarningDialog";
import { FigmaHydrationDialog } from "@/components/design/FigmaHydrationDialog";

import type { EditorClipboard } from "../domains/use-editor-clipboard";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorHistory } from "../domains/use-editor-history";
import type { EditorLayoutAndStructure } from "../domains/use-editor-layout-and-structure";
import type { EditorSourceAndSync } from "../domains/use-editor-source-and-sync";

export function renderEditorDialogs({
  editorCore,
  editorHistory,
  editorClipboard,
  editorLayoutAndStructure,
  editorSourceAndSync,
  id,
  pendingVisualStyleWarningOpen,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorClipboard: EditorClipboard;
  editorLayoutAndStructure: EditorLayoutAndStructure;
  editorSourceAndSync: EditorSourceAndSync;
  id: string;
  pendingVisualStyleWarningOpen: boolean;
}) {
  const { queryClient } = editorCore;
  const { pendingVisualEditCount } = editorHistory;
  const { figmaHydrationOpen, setFigmaHydrationOpen, figmaHydrationFileIds } =
    editorClipboard;
  const {
    autoLayoutSuggestionPreview,
    setAutoLayoutSuggestionPreview,
    handleApplyAutoLayoutSuggestion,
  } = editorLayoutAndStructure;
  const {
    handleStayOnPendingVisualStyleNavigation,
    handleDiscardPendingVisualStylesAndNavigate,
  } = editorSourceAndSync;

  return (
    <>
      <PendingVisualStyleWarningDialog
        open={pendingVisualStyleWarningOpen}
        pendingVisualEditCount={pendingVisualEditCount}
        onStay={handleStayOnPendingVisualStyleNavigation}
        onDiscardAndNavigate={handleDiscardPendingVisualStylesAndNavigate}
      />

      <AutoLayoutSuggestionDialog
        open={autoLayoutSuggestionPreview !== null}
        suggestion={autoLayoutSuggestionPreview?.suggestion ?? null}
        onOpenChange={(open) => {
          if (!open) setAutoLayoutSuggestionPreview(null);
        }}
        onApply={handleApplyAutoLayoutSuggestion}
      />

      <FigmaHydrationDialog
        open={figmaHydrationOpen}
        onOpenChange={setFigmaHydrationOpen}
        designId={id ?? ""}
        fileIds={figmaHydrationFileIds}
        onHydrated={() => {
          void queryClient.invalidateQueries({ queryKey: ["action"] });
        }}
      />
    </>
  );
}
