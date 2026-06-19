/**
 * Global sketchy/clean toggle for docs diagrams and wireframes. Flips the shared
 * `plan-wireframe-style` preference (localStorage, cross-tab synced) that every
 * `@agent-native/core/blocks` visual reads — the same store the Plan app uses, so
 * the choice follows the reader everywhere. Diagrams also expose a per-diagram
 * hover toggle; this is the always-available global control.
 */

import { IconPencil, IconVectorBezier2 } from "@tabler/icons-react";
import {
  toggleWireframeStyle,
  useWireframeStyle,
} from "@agent-native/core/blocks";

export default function SketchToggle() {
  const style = useWireframeStyle();
  const sketchy = style === "sketchy";
  const label = sketchy ? "Diagrams: hand-drawn" : "Diagrams: clean";

  return (
    <button
      type="button"
      onClick={() => toggleWireframeStyle()}
      aria-label={label}
      aria-pressed={sketchy}
      title={`${label} — click to switch`}
      className="hidden h-8 w-8 items-center justify-center rounded-md border border-[var(--docs-border)] text-[var(--fg-secondary)] transition hover:border-[var(--fg-secondary)] hover:text-[var(--fg)] sm:flex"
    >
      {sketchy ? (
        <IconPencil size={16} stroke={1.5} />
      ) : (
        <IconVectorBezier2 size={16} stroke={1.5} />
      )}
    </button>
  );
}
