import type { MotionNativeStyleInstance } from "@shared/motion-native-style";

import { MotionDock } from "@/components/design/MotionDock";
import { projectMotionLayerVisibility } from "@/pages/design-editor/motion-layer-visibility";
import { motionTextDocumentAsDockTracks } from "@/pages/design-editor/motion-state";

import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "../domains/use-editor-canvas-and-screens";
import type { EditorContentAndComponents } from "../domains/use-editor-content-and-components";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorGenerationAndAccess } from "../domains/use-editor-generation-and-access";
import type { EditorHistory } from "../domains/use-editor-history";
import type { EditorLayerActions } from "../domains/use-editor-layer-actions";
import type { EditorLiveEditsAndPresence } from "../domains/use-editor-live-edits-and-presence";
import { layerStateIdsForScreen } from "../layer-state-scope";

export function renderMotionDockPanel({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorActiveScreenAndGeometry,
  editorCanvasAndScreens,
  editorLiveEditsAndPresence,
  editorContentAndComponents,
  editorLayerActions,
  layerSidebarInset,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorCanvasAndScreens: EditorCanvasAndScreens;
  editorLiveEditsAndPresence: EditorLiveEditsAndPresence;
  editorContentAndComponents: EditorContentAndComponents;
  editorLayerActions: EditorLayerActions;
  layerSidebarInset: number;
}) {
  const { hostOwnsChrome } = editorCore;
  const {
    motionDockMounted,
    motionDockOpen,
    setMotionDockOpenAnimated,
    handleMotionDockExitComplete,
  } = editorHistory;
  const { canEditDesign, motionAutosavePending } = editorGenerationAndAccess;
  const { activeFile } = editorActiveScreenAndGeometry;
  const { canvasIframeRef } = editorCanvasAndScreens;
  const { handleToggleLayerHidden } = editorLayerActions;
  const {
    initialGenerationChromeLimited,
    motionLabEnabled,
    motionTracks,
    motionTextDocument,
    activeCodeLayerProjection,
    motionDurationMs,
    motionPlaybackMode,
    motionDefaultEase,
    motionAutoKeyframeEnabled,
    setMotionAutoKeyframeEnabled,
    motionPlayhead,
    setMotionPlayhead,
    handleMotionDockLiveStateChange,
    motionSelectedTarget,
    motionNativeStyles,
    setMotionNativeStyles,
    motionAudioClips,
    motionEasingVariables,
    setMotionEasingVariables,
  } = editorLiveEditsAndPresence;
  const {
    handleMotionDockTracksChange,
    handleMotionAudioClipsChange,
    handleMotionPlaybackModeChange,
    handleMotionDurationChange,
    motionLivePlayheadRef,
    motionControlsWritable,
    markMotionTracksDirty,
  } = editorContentAndComponents;
  const canWriteMotion = canEditDesign && motionControlsWritable;
  const hiddenLayerIds = activeFile?.id
    ? layerStateIdsForScreen(editorHistory.hiddenLayerIds, activeFile.id)
    : new Set<string>();
  const motionLayerVisibility = projectMotionLayerVisibility(
    activeCodeLayerProjection,
    hiddenLayerIds,
  );
  const layerLabels = new Map<string, string>();
  for (const node of activeCodeLayerProjection.nodes) {
    layerLabels.set(node.id, node.layerName);
    const motionNodeId = node.dataAttributes["data-agent-native-node-id"];
    if (motionNodeId) layerLabels.set(motionNodeId, node.layerName);
  }
  if (motionSelectedTarget) {
    layerLabels.set(motionSelectedTarget.nodeId, motionSelectedTarget.label);
  }
  const updateMotionNativeStyle = (
    instance: MotionNativeStyleInstance,
    index: number,
  ) => {
    if (!canWriteMotion) return;
    setMotionNativeStyles((current) => {
      const previous = current[index];
      if (
        !previous ||
        previous.styleKey !== instance.styleKey ||
        previous.targetNodeId !== instance.targetNodeId ||
        (previous.sourceInstanceId !== undefined &&
          instance.sourceInstanceId !== previous.sourceInstanceId)
      ) {
        return current;
      }
      const next = [...current];
      next[index] = instance;
      return next;
    });
    markMotionTracksDirty();
  };
  const removeMotionNativeStyle = (
    instance: MotionNativeStyleInstance,
    index: number,
  ) => {
    if (!canWriteMotion) return;
    setMotionNativeStyles((current) => {
      const previous = current[index];
      if (
        !previous ||
        previous.styleKey !== instance.styleKey ||
        previous.targetNodeId !== instance.targetNodeId ||
        (previous.sourceInstanceId !== undefined &&
          instance.sourceInstanceId !== previous.sourceInstanceId)
      ) {
        return current;
      }
      return current.filter((_, currentIndex) => currentIndex !== index);
    });
    markMotionTracksDirty();
  };

  return (
    <>
      {/* Motion dock (§6.3) — bottom timeline mounted while opening, open, or
          closing. Canvas remains visible above.
          Preview-only scrubbing fires a motion-preview postMessage to the
          canvas iframe; track/duration edits autosave through apply-motion-edit. */}
      {!hostOwnsChrome &&
      motionLabEnabled &&
      !initialGenerationChromeLimited &&
      activeFile &&
      motionDockMounted ? (
        <MotionDock
          tracks={[
            ...motionTracks,
            ...motionTextDocumentAsDockTracks(
              motionTextDocument,
              activeCodeLayerProjection,
            ),
          ]}
          nativeStyles={motionNativeStyles}
          audioClips={motionAudioClips}
          onAudioClipsChange={
            canWriteMotion ? handleMotionAudioClipsChange : undefined
          }
          easingVariables={motionEasingVariables}
          onEasingVariablesChange={(variables) => {
            setMotionEasingVariables(variables);
            markMotionTracksDirty();
          }}
          layerLabels={layerLabels}
          durationMs={motionDurationMs}
          playbackMode={motionPlaybackMode}
          onPlaybackModeChange={
            canWriteMotion ? handleMotionPlaybackModeChange : undefined
          }
          defaultEase={motionDefaultEase}
          open={motionDockOpen}
          onOpenChange={setMotionDockOpenAnimated}
          onExitComplete={handleMotionDockExitComplete}
          onTracksChange={
            canWriteMotion ? handleMotionDockTracksChange : undefined
          }
          onNativeStyleChange={
            canWriteMotion ? updateMotionNativeStyle : undefined
          }
          onNativeStyleSpanChange={
            canWriteMotion
              ? (instance, index, span) => {
                  const delay =
                    typeof instance.props.delay === "number"
                      ? instance.props.delay
                      : 0;
                  updateMotionNativeStyle(
                    {
                      ...instance,
                      timelineOffset: Math.max(0, span.startMs / 1000 - delay),
                      duration: span.durationMs / 1000,
                    },
                    index,
                  );
                }
              : undefined
          }
          onNativeStyleRemove={
            canWriteMotion ? removeMotionNativeStyle : undefined
          }
          onDurationChange={
            canWriteMotion ? handleMotionDurationChange : undefined
          }
          canvasIframeRef={canvasIframeRef}
          autoKeyframe={motionAutoKeyframeEnabled}
          onAutoKeyframeChange={
            canWriteMotion ? setMotionAutoKeyframeEnabled : undefined
          }
          playhead={motionPlayhead}
          onPlayheadChange={setMotionPlayhead}
          onLiveStateChange={handleMotionDockLiveStateChange}
          livePlayheadRef={motionLivePlayheadRef}
          selectedTarget={motionSelectedTarget}
          layerSidebarInset={layerSidebarInset}
          hiddenLayerIds={motionLayerVisibility.hiddenMotionNodeIds}
          onToggleLayerHidden={(motionNodeId, hidden) =>
            handleToggleLayerHidden(
              motionLayerVisibility.codeLayerIdByMotionNodeId.get(
                motionNodeId,
              ) ?? motionNodeId,
              hidden,
            )
          }
          readOnly={!canWriteMotion}
          applying={motionAutosavePending}
        />
      ) : null}
    </>
  );
}
