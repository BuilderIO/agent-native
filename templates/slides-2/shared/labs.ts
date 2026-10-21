import { defineLab, defineLabs } from "@agent-native/core/labs/registry";

export const SLIDES_LAYOUT_OVERFLOW_WARNING = defineLab({
  key: "slides.layout-overflow-warning",
  displayName: "Layout overflow warning",
  description: "Show the layout overflow warning in the editor.",
  keywords: "slides layout overflow warning canvas fit",
});

export const SLIDES_LABS = defineLabs([SLIDES_LAYOUT_OVERFLOW_WARNING]);
