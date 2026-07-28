/**
 * Pure data/logic for the full-screen Interact mode's device chrome bar
 * (ResponsiveInteractBar). Modeled on builder-internal's
 * ResponsiveEditingMode/responsive-device-presets, adapted to this app's
 * shadcn chrome. Kept separate from DEVICE_FRAME_VIEWPORTS in
 * components/design/types.ts — that record is a fixed 3-category decorative
 * frame (desktop/tablet/mobile chrome border) used elsewhere in the editor,
 * not a device-simulation preset list with named devices and exact W×H.
 */

export type InteractDeviceCategory = "phone" | "tablet" | "desktop" | "custom";

export interface InteractDevicePreset {
  name: string;
  width: number;
  height: number;
  category: InteractDeviceCategory;
}

/** Preset name used whenever the user types a width/height directly. */
export const INTERACT_CUSTOM_DEVICE_NAME = "Custom";

export const INTERACT_DEVICE_PRESETS: InteractDevicePreset[] = [
  { name: "iPhone SE", category: "phone", width: 320, height: 568 },
  { name: "iPhone 17", category: "phone", width: 402, height: 874 },
  { name: "iPhone 17 Pro Max", category: "phone", width: 440, height: 956 },
  { name: "Android Compact", category: "phone", width: 412, height: 917 },
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

export const DEFAULT_INTERACT_DEVICE_PRESET = INTERACT_DEVICE_PRESETS[1]!;

export function findInteractDevicePreset(
  name: string,
): InteractDevicePreset | undefined {
  return INTERACT_DEVICE_PRESETS.find((preset) => preset.name === name);
}

/**
 * Auto-fit zoom for the full-screen device box, ported from
 * builder-internal's ResponsiveEditingMode effect (~lines 155-174): only
 * zooms DOWN so the device fits the available chrome area, never zooms in
 * past 100% just because there's extra room. Steps to the nearest 5 and
 * clamps to [minZoom, 100] so the result always lands on a clean number.
 */
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
