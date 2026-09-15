import {
  findUnreadableTextColors,
  formatSlideContrastWarning,
} from "@agent-native/core/shared";

import { backgroundContrastValue } from "../shared/slide-background.js";
import { inheritedSlideCanvas } from "./_design-system-canvas.js";

/**
 * The contrast warning for one slide that was just written.
 *
 * A slide often declares no background of its own and renders on the canvas
 * it inherits from the deck's linked design system. Checking only the
 * submitted markup makes those slides invisible to the audit, which is exactly
 * how light text on a light design-system canvas shipped. Resolving the system
 * costs a read, so it is only done for the slides that need it: when the
 * markup already names a canvas there is nothing to inherit.
 */
export async function slideContrastWarning({
  html,
  background,
  designSystemId,
}: {
  html: string;
  background?: string | null;
  designSystemId?: string | null;
}): Promise<string | null> {
  const declared = backgroundContrastValue(background ?? undefined);
  const report = findUnreadableTextColors({ html, slideBackground: declared });
  // A slide that names its own canvas is already checked against it. That
  // includes a canvas this module cannot parse (a named utility): inheriting
  // over it would audit the slide against a canvas it does not render on.
  if (report.checkedBackgrounds.length > 0 || background) {
    return formatSlideContrastWarning(report);
  }

  const inherited = await inheritedSlideCanvas(designSystemId);
  if (!inherited) return formatSlideContrastWarning(report);
  return formatSlideContrastWarning(
    findUnreadableTextColors({ html, slideBackground: inherited }),
  );
}
