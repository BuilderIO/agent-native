import { FoldedRibbon } from "./folded-ribbon";

export function HeroBackground() {
  // Frames the ribbon from under the 64px sticky header, so its fold sits at
  // the same height relative to the headline as the original composition.
  return (
    <FoldedRibbon className="absolute inset-x-0 top-[-64px] bottom-0 z-[-1]" />
  );
}
