import {
  DEFAULT_INTERACT_DEVICE_PRESET,
  INTERACT_CUSTOM_DEVICE_NAME,
  INTERACT_DEVICE_PRESETS,
  type InteractDevicePreset,
} from "@shared/interact-device-presets";

export {
  DEFAULT_INTERACT_DEVICE_PRESET,
  findInteractDevicePreset,
  findSelectableInteractDevicePreset,
  INTERACT_CUSTOM_DEVICE_NAME,
  INTERACT_DEVICE_PRESETS,
  SELECTABLE_INTERACT_DEVICE_PRESETS,
  type InteractDeviceCategory,
  type InteractDevicePreset,
} from "@shared/interact-device-presets";

export function resolveInteractDeviceForScreen(screen?: {
  width?: number | null;
  height?: number | null;
}): InteractDevicePreset {
  const width =
    typeof screen?.width === "number" &&
    Number.isFinite(screen.width) &&
    screen.width > 0
      ? Math.round(screen.width)
      : DEFAULT_INTERACT_DEVICE_PRESET.width;
  const height =
    typeof screen?.height === "number" &&
    Number.isFinite(screen.height) &&
    screen.height > 0
      ? Math.round(screen.height)
      : DEFAULT_INTERACT_DEVICE_PRESET.height;
  const preset = INTERACT_DEVICE_PRESETS.find(
    (candidate) =>
      candidate.category !== "custom" &&
      candidate.width === width &&
      candidate.height === height,
  );
  return (
    preset ?? {
      name: INTERACT_CUSTOM_DEVICE_NAME,
      category: "custom",
      width,
      height,
    }
  );
}

export function formatInteractZoom(zoom: number): string {
  return Number.isFinite(zoom) ? zoom.toFixed(1) : "100.0";
}

export function computeInteractZoomToFit(params: {
  availableWidth: number;
  availableHeight: number;
  deviceWidth: number;
  deviceHeight: number;
  minZoom?: number;
}): number {
  const {
    availableWidth,
    availableHeight,
    deviceWidth,
    deviceHeight,
    minZoom = 10,
  } = params;
  if (deviceWidth <= 0 || deviceHeight <= 0) return 100;
  const widthScale = availableWidth / deviceWidth;
  const heightScale = availableHeight / deviceHeight;
  const optimalZoom = Math.min(widthScale, heightScale) * 100;
  if (optimalZoom >= 100) return 100;
  const stepped = Math.floor(optimalZoom / 5) * 5;
  return Math.max(minZoom, Math.min(100, stepped));
}
