import { MotionDock } from "@/components/design/MotionDock";

import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "../domains/use-editor-canvas-and-screens";
import type { EditorContentAndComponents } from "../domains/use-editor-content-and-components";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorGenerationAndAccess } from "../domains/use-editor-generation-and-access";
import type { EditorHistory } from "../domains/use-editor-history";
import type { EditorLiveEditsAndPresence } from "../domains/use-editor-live-edits-and-presence";
import { SHOW_DESIGN_SECONDARY_LEFT_PANELS } from "../types";

export function renderMotionDockPanel({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorActiveScreenAndGeometry,
  editorCanvasAndScreens,
  editorLiveEditsAndPresence,
  editorContentAndComponents,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorCanvasAndScreens: EditorCanvasAndScreens;
  editorLiveEditsAndPresence: EditorLiveEditsAndPresence;
  editorContentAndComponents: EditorContentAndComponents;
}) {
  const { hostOwnsChrome } = editorCore;
  const {
    motionDockMounted,
    motionDockOpen,
    setMotionDockOpenAnimated,
    handleMotionDockExitComplete,
  } = editorHistory;
  const { motionAutosavePending } = editorGenerationAndAccess;
  const { activeFile } = editorActiveScreenAndGeometry;
  const { canvasIframeRef } = editorCanvasAndScreens;
  const {
    initialGenerationChromeLimited,
    motionTracks,
    motionDurationMs,
    motionDefaultEase,
    motionAutoKeyframeEnabled,
    setMotionAutoKeyframeEnabled,
    motionPlayhead,
    setMotionPlayhead,
    motionSelectedTarget,
  } = editorLiveEditsAndPresence;
  const {
    handleMotionTracksChange,
    handleMotionDurationChange,
    motionLivePlayheadRef,
  } = editorContentAndComponents;

  return (
    <>
      {/* Motion dock (§6.3) — bottom timeline mounted while opening, open, or
          closing. Canvas remains visible above.
          Preview-only scrubbing fires a motion-preview postMessage to the
          canvas iframe; track/duration edits autosave through apply-motion-edit. */}
      {!hostOwnsChrome &&
      SHOW_DESIGN_SECONDARY_LEFT_PANELS &&
      !initialGenerationChromeLimited &&
      activeFile &&
      motionDockMounted ? (
        <MotionDock
          tracks={motionTracks}
          durationMs={motionDurationMs}
          defaultEase={motionDefaultEase}
          open={motionDockOpen}
          onOpenChange={setMotionDockOpenAnimated}
          onExitComplete={handleMotionDockExitComplete}
          onTracksChange={handleMotionTracksChange}
          onDurationChange={handleMotionDurationChange}
          canvasIframeRef={canvasIframeRef}
          autoKeyframe={motionAutoKeyframeEnabled}
          onAutoKeyframeChange={setMotionAutoKeyframeEnabled}
          playhead={motionPlayhead}
          onPlayheadChange={setMotionPlayhead}
          livePlayheadRef={motionLivePlayheadRef}
          selectedTarget={motionSelectedTarget}
          applying={motionAutosavePending}
        />
      ) : null}
    </>
  );
}
