import type { InteractDeviceCategory } from "@shared/interact-device-presets";

// Written out in full so Tailwind finds them. The frame scales with the zoom,
// so a corner keeps its proportion to the device at every zoom.
const CORNER_CLASS = {
  phone: "rounded-4xl",
  tablet: "rounded-3xl",
  desktop: "rounded-xl",
} as const;

// Past these widths a screen no preset names reads as the next size up.
const PHONE_MAX_WIDTH = 480;
const TABLET_MAX_WIDTH = 900;

/**
 * The corner of the Interact device frame: round on a phone, softer on a
 * tablet, slight on a desktop. A preset says which it is; a screen matching no
 * preset is told by its width.
 */
export function getInteractFrameCornerClass({
  category,
  width,
}: {
  category?: InteractDeviceCategory;
  width: number;
}): string {
  if (category === "phone" || category === "tablet" || category === "desktop") {
    return CORNER_CLASS[category];
  }
  if (width <= PHONE_MAX_WIDTH) return CORNER_CLASS.phone;
  if (width <= TABLET_MAX_WIDTH) return CORNER_CLASS.tablet;
  return CORNER_CLASS.desktop;
}
