import type { ReactElement, ReactNode } from "react";

import {
  InteractDevicePicker,
  InteractFloatingBar,
  InteractRouteControls,
  InteractThemePicker,
  InteractZoomReadout,
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
    interactRoutes,
    canGoBackInteractRoute,
    canGoForwardInteractRoute,
    handleInteractRouteSelect,
    handleInteractRouteBack,
    handleInteractRouteForward,
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
    themePicker: (
      <InteractThemePicker
        mode={interactPreviewTheme.displayMode}
        canPick={interactPreviewTheme.canPick}
        darkAvailable={interactPreviewTheme.darkAvailable}
        onChange={handleInteractThemeChange}
      />
    ),
    routeControls: (
      <InteractRouteControls
        routes={interactRoutes}
        activeScreenId={activeScreenId}
        canGoBack={canGoBackInteractRoute}
        canGoForward={canGoForwardInteractRoute}
        onSelect={handleInteractRouteSelect}
        onBack={handleInteractRouteBack}
        onForward={handleInteractRouteForward}
        onReload={handleScreenReload}
      />
    ),
  };
}

/**
 * Interact's controls for the docked top bar: device and theme beside the mode
 * switch, route controls in the centre, the fit zoom beside Share. The mode
 * switch is the way out, so none of these is an exit.
 */
export function renderInteractTopBarSlots(args: InteractControlsArgs): {
  leading: ReactNode;
  center: ReactNode;
  zoomControl: ReactNode;
} {
  const { devicePicker, themePicker, routeControls } =
    renderInteractPieces(args);
  return {
    leading: (
      <>
        {devicePicker}
        {themePicker}
      </>
    ),
    center: routeControls,
    zoomControl: <InteractZoomReadout zoom={args.editorModes.interactZoom} />,
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
