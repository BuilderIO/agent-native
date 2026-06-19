/**
 * Global sketchy/clean toggle for docs diagrams and wireframes. Flips the shared
 * `plan-wireframe-style` preference (localStorage, cross-tab synced) that every
 * `@agent-native/core/blocks` visual reads — the same store the Plan app uses, so
 * the choice follows the reader everywhere. Diagrams also expose a per-diagram
 * hover toggle; this is the always-available global control.
 */

import { IconScribble, IconShape2 } from "@tabler/icons-react";
import {
  toggleWireframeStyle,
  useWireframeStyle,
} from "@agent-native/core/blocks";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

export default function SketchToggle() {
  const style = useWireframeStyle();
  const sketchy = style === "sketchy";
  const label = sketchy ? "Diagrams: hand-drawn" : "Diagrams: clean";
  const tooltip = sketchy
    ? "Hand-drawn diagrams - switch to clean"
    : "Clean diagrams - switch to hand-drawn";

  return (
    <TooltipProvider delayDuration={100} skipDelayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => toggleWireframeStyle()}
            aria-label={label}
            aria-pressed={sketchy}
            className="hidden h-8 w-8 items-center justify-center rounded-md border border-[var(--docs-border)] text-[var(--fg-secondary)] transition hover:border-[var(--fg-secondary)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:flex"
          >
            {sketchy ? (
              <IconScribble size={16} stroke={1.5} />
            ) : (
              <IconShape2 size={16} stroke={1.5} />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
