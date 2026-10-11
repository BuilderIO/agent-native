import { ResponsiveInteractBar } from "@/components/design/ResponsiveInteractBar";

import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorGenerationAndAccess } from "../domains/use-editor-generation-and-access";
import type { EditorModes } from "../domains/use-editor-modes";

export function renderResponsiveInteractToolbar({
  editorGenerationAndAccess,
  editorActiveScreenAndGeometry,
  editorModes,
  floating,
}: {
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorModes: EditorModes;
  floating: boolean;
}) {
  const { setRuntimeLayerSnapshotRequest, canEditDesign } =
    editorGenerationAndAccess;
  const {
    interactDeviceName,
    interactDeviceSize,
    handleInteractDeviceChange,
    handleInteractWidthChange,
    handleInteractHeightChange,
  } = editorActiveScreenAndGeometry;
  const { handleModeChange, handleExitResponsiveInteract } = editorModes;

  return (
    <ResponsiveInteractBar
      deviceName={interactDeviceName}
      width={interactDeviceSize.width}
      height={interactDeviceSize.height}
      onDeviceChange={handleInteractDeviceChange}
      onWidthChange={handleInteractWidthChange}
      onHeightChange={handleInteractHeightChange}
      onModeChange={(next) => {
        if (next === "edit") {
          setRuntimeLayerSnapshotRequest(Date.now() + Math.random());
        }
        handleModeChange(next);
      }}
      canAnnotate={canEditDesign}
      onClose={handleExitResponsiveInteract}
      showClose={floating}
      className={
        floating
          ? "pointer-events-auto w-full max-w-[680px] rounded-lg border shadow-xl"
          : undefined
      }
    />
  );
}
