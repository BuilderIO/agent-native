import type { ReactElement, ReactNode } from "react";

import {
  InteractDevicePicker,
  InteractFloatingBar,
  InteractScreenControls,
  InteractThemePicker,
} from "@/components/design/editor/InteractControls";
import { InteractZoomControl } from "@/components/design/editor/InteractZoomControl";

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

/**
 * Interact's controls for the docked top bar: device and theme beside the mode
 * switch, screen controls in the centre, the fit zoom beside Share. The mode
 * switch is the way out, so none of these is an exit.
 */
export function renderInteractTopBarSlots(args: InteractControlsArgs): {
  leading: ReactNode;
  center: ReactNode;
  zoomControl: ReactNode;
} {
  const { devicePicker, themePicker, screenControls } =
    renderInteractPieces(args);
  return {
    leading: (
      <>
        {devicePicker}
        {themePicker}
      </>
    ),
    center: screenControls,
    zoomControl: (
      <InteractZoomControl
        zoom={args.editorModes.interactZoom}
        choice={args.editorModes.interactZoomChoice}
        onChange={args.editorModes.handleInteractZoomChange}
      />
    ),
  };
}

/** Minimal UI has no top bar, so the same controls float with an exit. */
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
