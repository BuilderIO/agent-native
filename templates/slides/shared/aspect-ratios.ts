export const ASPECT_RATIOS = {
  "16:9": {
    width: 960,
    height: 540,
    label: "16:9",
    pptxInches: { w: 13.33, h: 7.5 },
  },
  "1:1": {
    width: 1080,
    height: 1080,
    label: "1:1",
    pptxInches: { w: 10, h: 10 },
  },
  "9:16": {
    width: 540,
    height: 960,
    label: "9:16",
    pptxInches: { w: 7.5, h: 13.33 },
  },
  "4:5": {
    width: 864,
    height: 1080,
    label: "4:5",
    pptxInches: { w: 8, h: 10 },
  },
} as const;

export type AspectRatio = keyof typeof ASPECT_RATIOS;
export const ASPECT_RATIO_VALUES = ["16:9", "1:1", "9:16", "4:5"] as const;
export const DEFAULT_ASPECT_RATIO: AspectRatio = "16:9";

export function getAspectRatioDims(ratio: AspectRatio | undefined | null) {
  return (
    ASPECT_RATIOS[ratio as AspectRatio] ?? ASPECT_RATIOS[DEFAULT_ASPECT_RATIO]
  );
}
