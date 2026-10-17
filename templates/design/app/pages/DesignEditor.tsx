import { useParams } from "react-router";

import { useContainHorizontalOverscroll } from "@/hooks/use-contain-horizontal-overscroll";

import { renderDesignEditorView } from "./design-editor/design-editor-view";
import { useEditorActiveScreenAndGeometry } from "./design-editor/domains/use-editor-active-screen-and-geometry";
import { useEditorCanvasAndScreens } from "./design-editor/domains/use-editor-canvas-and-screens";
import { useEditorClipboard } from "./design-editor/domains/use-editor-clipboard";
import { useEditorContentAndComponents } from "./design-editor/domains/use-editor-content-and-components";
import { useEditorCore } from "./design-editor/domains/use-editor-core";
import { useEditorEditCommands } from "./design-editor/domains/use-editor-edit-commands";
import { useEditorExportAndHandoff } from "./design-editor/domains/use-editor-export-and-handoff";
import { useEditorFilesAndSaving } from "./design-editor/domains/use-editor-files-and-saving";
import { useEditorGenerationAndAccess } from "./design-editor/domains/use-editor-generation-and-access";
import { useEditorHistory } from "./design-editor/domains/use-editor-history";
import { useEditorLayerActions } from "./design-editor/domains/use-editor-layer-actions";
import { useEditorLayerModels } from "./design-editor/domains/use-editor-layer-models";
import { useEditorLayoutAndStructure } from "./design-editor/domains/use-editor-layout-and-structure";
import { useEditorLiveEditsAndPresence } from "./design-editor/domains/use-editor-live-edits-and-presence";
import { useEditorModes } from "./design-editor/domains/use-editor-modes";
import { useEditorScreenChangeHandlers } from "./design-editor/domains/use-editor-screen-change-handlers";
import { useEditorScreenInspector } from "./design-editor/domains/use-editor-screen-inspector";
import { useEditorScreenRendering } from "./design-editor/domains/use-editor-screen-rendering";
import { useEditorSelectionAndStyles } from "./design-editor/domains/use-editor-selection-and-styles";
import { useEditorSourceAndSync } from "./design-editor/domains/use-editor-source-and-sync";
import { useEditorToolsAndVectors } from "./design-editor/domains/use-editor-tools-and-vectors";

export default function DesignEditorRoute() {
  const { id } = useParams<{ id: string }>();
  useContainHorizontalOverscroll();
  return <DesignEditor key={id ?? "missing-design"} />;
}

function DesignEditor() {
  const editorCore = useEditorCore();
  const editorHistory = useEditorHistory({ editorCore });
  const editorGenerationAndAccess = useEditorGenerationAndAccess({
    editorCore,
    editorHistory,
  });
  const editorFilesAndSaving = useEditorFilesAndSaving({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
  });
  const editorActiveScreenAndGeometry = useEditorActiveScreenAndGeometry({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
  });
  const editorCanvasAndScreens = useEditorCanvasAndScreens({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
  });
  const editorLiveEditsAndPresence = useEditorLiveEditsAndPresence({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
  });
  const editorContentAndComponents = useEditorContentAndComponents({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorLiveEditsAndPresence,
  });
  const editorToolsAndVectors = useEditorToolsAndVectors({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorLiveEditsAndPresence,
    editorContentAndComponents,
  });
  const editorSelectionAndStyles = useEditorSelectionAndStyles({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorLiveEditsAndPresence,
    editorContentAndComponents,
    editorToolsAndVectors,
  });
  const editorScreenChangeHandlers = useEditorScreenChangeHandlers({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorLiveEditsAndPresence,
    editorContentAndComponents,
    editorSelectionAndStyles,
  });
  const editorClipboard = useEditorClipboard({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorLiveEditsAndPresence,
    editorContentAndComponents,
    editorToolsAndVectors,
    editorSelectionAndStyles,
    editorScreenChangeHandlers,
  });
  const editorLayoutAndStructure = useEditorLayoutAndStructure({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorLiveEditsAndPresence,
    editorContentAndComponents,
    editorToolsAndVectors,
    editorSelectionAndStyles,
    editorScreenChangeHandlers,
    editorClipboard,
  });
  const editorEditCommands = useEditorEditCommands({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorLiveEditsAndPresence,
    editorContentAndComponents,
    editorToolsAndVectors,
    editorSelectionAndStyles,
    editorScreenChangeHandlers,
    editorClipboard,
    editorLayoutAndStructure,
  });
  const editorModes = useEditorModes({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorLiveEditsAndPresence,
    editorContentAndComponents,
    editorToolsAndVectors,
    editorLayoutAndStructure,
    editorEditCommands,
  });
  const editorExportAndHandoff = useEditorExportAndHandoff({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorLiveEditsAndPresence,
    editorContentAndComponents,
    editorToolsAndVectors,
    editorSelectionAndStyles,
  });
  const editorLayerModels = useEditorLayerModels({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorLiveEditsAndPresence,
    editorContentAndComponents,
    editorSelectionAndStyles,
    editorExportAndHandoff,
  });
  const editorScreenInspector = useEditorScreenInspector({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorLiveEditsAndPresence,
    editorContentAndComponents,
    editorToolsAndVectors,
    editorSelectionAndStyles,
    editorClipboard,
    editorEditCommands,
    editorLayerModels,
  });
  const editorLayerActions = useEditorLayerActions({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorLiveEditsAndPresence,
    editorContentAndComponents,
    editorToolsAndVectors,
    editorSelectionAndStyles,
    editorClipboard,
    editorLayoutAndStructure,
    editorEditCommands,
    editorLayerModels,
  });
  const editorSourceAndSync = useEditorSourceAndSync({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorLiveEditsAndPresence,
    editorContentAndComponents,
    editorToolsAndVectors,
    editorSelectionAndStyles,
    editorClipboard,
    editorLayoutAndStructure,
    editorEditCommands,
    editorModes,
    editorExportAndHandoff,
    editorLayerModels,
    editorScreenInspector,
    editorLayerActions,
  });
  const editorScreenRendering = useEditorScreenRendering({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorLiveEditsAndPresence,
    editorContentAndComponents,
    editorToolsAndVectors,
    editorSelectionAndStyles,
    editorScreenChangeHandlers,
    editorClipboard,
    editorLayoutAndStructure,
    editorEditCommands,
    editorModes,
    editorExportAndHandoff,
    editorLayerModels,
    editorLayerActions,
    editorSourceAndSync,
  });
  return renderDesignEditorView({
    editorCore,
    editorHistory,
    editorGenerationAndAccess,
    editorFilesAndSaving,
    editorActiveScreenAndGeometry,
    editorCanvasAndScreens,
    editorLiveEditsAndPresence,
    editorContentAndComponents,
    editorToolsAndVectors,
    editorSelectionAndStyles,
    editorScreenChangeHandlers,
    editorClipboard,
    editorLayoutAndStructure,
    editorEditCommands,
    editorModes,
    editorExportAndHandoff,
    editorLayerModels,
    editorScreenInspector,
    editorLayerActions,
    editorSourceAndSync,
    editorScreenRendering,
  });
}
