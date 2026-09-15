import {
  findUnreadableTextColors,
  formatSlideContrastWarning,
} from "@agent-native/core/shared";

import { backgroundCssValue } from "../shared/slide-background.js";
import getDesignSystem from "./get-design-system.js";

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
  const slideBackground = background ? backgroundCssValue(background) : null;
  const report = findUnreadableTextColors({ html, slideBackground });
  if (report.checkedBackgrounds.length > 0 || !designSystemId) {
    return formatSlideContrastWarning(report);
  }

  const inherited = await inheritedCanvas(designSystemId);
  if (!inherited) return formatSlideContrastWarning(report);
  return formatSlideContrastWarning(
    findUnreadableTextColors({ html, slideBackground: inherited }),
  );
}

async function inheritedCanvas(designSystemId: string): Promise<string | null> {
  try {
    const system = (await getDesignSystem.run({
      id: designSystemId,
      compact: "true",
    })) as { colorMode?: { background?: unknown } } | undefined;
    const background = system?.colorMode?.background;
    return typeof background === "string" && background ? background : null;
  } catch {
    // coercion-ok: null means "no canvas to check against", which leaves the
    // markup-only report standing. It never turns an unreadable slide into a
    // readable one, and a failed lookup must not fail the write itself.
    return null;
  }
}
