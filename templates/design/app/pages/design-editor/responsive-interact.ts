
export type InteractDeviceCategory = "phone" | "tablet" | "desktop" | "custom";

export interface InteractDevicePreset {
  name: string;
  width: number;
  height: number;
  category: InteractDeviceCategory;
}

export const INTERACT_CUSTOM_DEVICE_NAME = "Custom";

export const RESPONSIVE_INTERACT_BAR_HEIGHT = 48;

export const INTERACT_DEVICE_PRESETS: InteractDevicePreset[] = [
  { name: "iPhone SE", category: "phone", width: 320, height: 568 }, // i18n-ignore: stable device preset name.
  { name: "iPhone 17", category: "phone", width: 402, height: 874 }, // i18n-ignore: stable device preset name.
  { name: "iPhone 17 Pro Max", category: "phone", width: 440, height: 956 }, // i18n-ignore: stable device preset name.
  { name: "Android Compact", category: "phone", width: 412, height: 917 }, // i18n-ignore: stable device preset name.
  {
    name: 'iPad Pro 11" Portrait',
    category: "tablet",
    width: 834,
    height: 1194,
  },
  {
    name: 'iPad Pro 11" Landscape',
    category: "tablet",
    width: 1194,
    height: 834,
  },
  { name: 'MacBook Air 13"', category: "desktop", width: 1440, height: 900 },
  {
    name: INTERACT_CUSTOM_DEVICE_NAME,
    category: "custom",
    width: 402,
    height: 874,
  },
];

export const DEFAULT_INTERACT_DEVICE_PRESET = INTERACT_DEVICE_PRESETS.find(
  (preset) => preset.category === "desktop",
)!;

export function findInteractDevicePreset(
  name: string,
): InteractDevicePreset | undefined {
  return INTERACT_DEVICE_PRESETS.find((preset) => preset.name === name);
}

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
