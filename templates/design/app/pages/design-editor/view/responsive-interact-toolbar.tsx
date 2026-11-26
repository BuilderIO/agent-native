import type { ReactElement } from "react";

import {
  InteractDevicePicker,
  InteractFloatingBar,
  InteractScreenControls,
  InteractThemePicker,
} from "@/components/design/editor/InteractControls";

import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorModes } from "../domains/use-editor-modes";

interface InteractControlsArgs {
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorModes: EditorModes;
  activeScreenId: string | null;
}

function renderInteractPieces({
  editorActiveScreenAndGeometry,
  editorModes,
  activeScreenId,
}: InteractControlsArgs) {
  const { interactDeviceName, interactDeviceSize, handleInteractDeviceChange } =
    editorActiveScreenAndGeometry;
  const {
    interactScreens,
    canGoBackInteractScreen,
    canGoForwardInteractScreen,
    handleInteractScreenSelect,
    handleInteractScreenBack,
    handleInteractScreenForward,
    handleScreenReload,
    interactPreviewTheme,
    handleInteractThemeChange,
  } = editorModes;
  return {
    devicePicker: (
      <InteractDevicePicker
        deviceName={interactDeviceName}
        width={interactDeviceSize.width}
        height={interactDeviceSize.height}
        onChange={handleInteractDeviceChange}
      />
    ),
    // Absent, not disabled, on a URL-backed screen: the grid columns around it
    // do not move, so the screen controls stay centred either way.
    themePicker: interactPreviewTheme.pickerVisible ? (
      <InteractThemePicker
        mode={interactPreviewTheme.displayMode}
        darkAvailable={interactPreviewTheme.darkAvailable}
        onChange={handleInteractThemeChange}
      />
    ) : null,
    screenControls: (
      <InteractScreenControls
        screens={interactScreens}
        activeScreenId={activeScreenId}
        canGoBack={canGoBackInteractScreen}
        canGoForward={canGoForwardInteractScreen}
        onSelect={handleInteractScreenSelect}
        onBack={handleInteractScreenBack}
        onForward={handleInteractScreenForward}
        onReload={handleScreenReload}
      />
    ),
  };
}

export function renderInteractFloatingBar(
  args: InteractControlsArgs,
): ReactElement {
  const pieces = renderInteractPieces(args);
  return (
    <InteractFloatingBar
      {...pieces}
      onExit={args.editorModes.handleExitResponsiveInteract}
    />
  );
}
