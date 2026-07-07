/**
 * Frame-tool size presets — the equivalent of Figma's right-panel preset list
 * that replaces the inspector while the Frame tool (F / A) is armed. Each
 * category maps to a `framePresets.categories.<key>` i18n label; preset
 * `name` values are product/device names and are intentionally left as
 * untranslated literals (matching Figma's own behavior).
 *
 * Pure data + a couple of small pure helpers so the shape can be unit tested
 * without mounting EditPanel.
 *
 * i18n-raw-literal-disable-file: every `name` below is a real-world
 * product/device name (iPhone, Android, Instagram Post, etc.) and must stay
 * untranslated in every locale, matching Figma's own preset list behavior.
 */

export type FrameSizePresetCategoryKey =
  | "phone"
  | "tablet"
  | "desktop"
  | "presentation"
  | "watch"
  | "paper"
  | "socialMedia";

export interface FrameSizePreset {
  /** Product/device name — kept as a literal, never translated. */
  name: string;
  width: number;
  height: number;
}

export interface FrameSizePresetCategory {
  key: FrameSizePresetCategoryKey;
  presets: FrameSizePreset[];
}

/**
 * Ordered categories, first-group-expanded-by-default matching Figma (Phone
 * first). Sizes are Figma's current preset list, abbreviated to the most
 * common devices per category.
 */
export const FRAME_SIZE_PRESET_CATEGORIES: FrameSizePresetCategory[] = [
  {
    key: "phone",
    presets: [
      { name: "iPhone 17", width: 402, height: 874 },
      { name: "iPhone 16 & 17 Pro", width: 402, height: 874 },
      { name: "iPhone 16", width: 393, height: 852 },
      { name: "iPhone 16 & 17 Pro Max", width: 440, height: 956 },
      { name: "iPhone 16 Plus", width: 430, height: 932 },
      { name: "iPhone Air", width: 420, height: 912 },
      { name: "iPhone 14 & 15 Pro Max", width: 430, height: 932 },
      { name: "iPhone 14 & 15 Pro", width: 393, height: 852 },
      { name: "iPhone 13 & 14", width: 390, height: 844 },
      { name: "iPhone 14 Plus", width: 428, height: 926 },
      { name: "Android Compact", width: 412, height: 917 },
      { name: "Android Medium", width: 700, height: 840 },
    ],
  },
  {
    key: "tablet",
    presets: [
      { name: "iPad mini 8.3", width: 744, height: 1133 },
      { name: "Surface Pro 8", width: 1440, height: 960 },
      { name: 'iPad Pro 11"', width: 834, height: 1194 },
      { name: 'iPad Pro 12.9"', width: 1024, height: 1366 },
      { name: "Android Expanded", width: 1280, height: 800 },
    ],
  },
  {
    key: "desktop",
    presets: [
      { name: "Desktop", width: 1440, height: 1024 },
      { name: "Wireframe", width: 1440, height: 1024 },
      { name: "MacBook Air", width: 1280, height: 832 },
      { name: 'MacBook Pro 14"', width: 1512, height: 982 },
      { name: 'MacBook Pro 16"', width: 1728, height: 1117 },
      { name: "TV", width: 1280, height: 720 },
    ],
  },
  {
    key: "presentation",
    presets: [
      { name: "Slide 16:9", width: 1920, height: 1080 },
      { name: "Slide 4:3", width: 1024, height: 768 },
    ],
  },
  {
    key: "watch",
    presets: [{ name: "Apple Watch 45mm", width: 198, height: 242 }],
  },
  {
    key: "paper",
    presets: [
      { name: "A4", width: 595, height: 842 },
      { name: "A5", width: 420, height: 595 },
      { name: "Letter", width: 612, height: 792 },
      { name: "Tabloid", width: 792, height: 1224 },
    ],
  },
  {
    key: "socialMedia",
    presets: [
      { name: "Instagram Post", width: 1080, height: 1080 },
      { name: "Instagram Story", width: 1080, height: 1920 },
      { name: "X Post", width: 1200, height: 675 },
      { name: "Facebook Cover", width: 820, height: 312 },
      { name: "LinkedIn Cover", width: 1584, height: 396 },
    ],
  },
];

/** Flat list of every preset across all categories — used for lookups/tests. */
export function allFrameSizePresets(): FrameSizePreset[] {
  return FRAME_SIZE_PRESET_CATEGORIES.flatMap((category) => category.presets);
}
