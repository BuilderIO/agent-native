export type InteractDeviceCategory = "phone" | "tablet" | "desktop" | "custom";

export interface InteractDevicePreset {
  name: string;
  width: number;
  height: number;
  category: InteractDeviceCategory;
}

/**
 * Stands for a screen whose size matches no preset. It is a display state, not
 * a choice: the picker shows it read-only because the size can only change in
 * Design mode.
 */
export const INTERACT_CUSTOM_DEVICE_NAME = "Custom";

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

/** The presets a person can pick; `Custom` is only ever shown. */
export const SELECTABLE_INTERACT_DEVICE_PRESETS: InteractDevicePreset[] =
  INTERACT_DEVICE_PRESETS.filter((preset) => preset.category !== "custom");

export const DEFAULT_INTERACT_DEVICE_PRESET = INTERACT_DEVICE_PRESETS.find(
  (preset) => preset.category === "desktop",
)!;

export function findInteractDevicePreset(
  name: string,
): InteractDevicePreset | undefined {
  return INTERACT_DEVICE_PRESETS.find((preset) => preset.name === name);
}

export function findSelectableInteractDevicePreset(
  name: unknown,
): InteractDevicePreset | undefined {
  return typeof name === "string"
    ? SELECTABLE_INTERACT_DEVICE_PRESETS.find((preset) => preset.name === name)
    : undefined;
}
