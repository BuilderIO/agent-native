import { cn } from "@/lib/utils";

interface IconProps {
  className?: string;
}

// Gap icon: ]·[ — two inward-facing C-brackets with a center dot
export function IconGap({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      {/* Left bracket ] — vertical bar on right side, serifs pointing right */}
      <line x1="9" y1="7" x2="6" y2="7" />
      <line x1="6" y1="7" x2="6" y2="17" />
      <line x1="6" y1="17" x2="9" y2="17" />
      {/* Center dot */}
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      {/* Right bracket [ — vertical bar on left side, serifs pointing left */}
      <line x1="15" y1="7" x2="18" y2="7" />
      <line x1="18" y1="7" x2="18" y2="17" />
      <line x1="18" y1="17" x2="15" y2="17" />
    </svg>
  );
}

// Padding horizontal: square with thick left and right edges
export function IconPaddingHorizontal({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      {/* Outer frame */}
      <rect x="3" y="4" width="18" height="16" rx="1.5" strokeWidth={1.5} />
      {/* Thick left edge fill */}
      <rect
        x="3"
        y="4"
        width="4"
        height="16"
        rx="1.5"
        fill="currentColor"
        stroke="none"
      />
      {/* Thick right edge fill */}
      <rect
        x="17"
        y="4"
        width="4"
        height="16"
        rx="1.5"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

// Padding vertical: square with thick top and bottom edges
export function IconPaddingVertical({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      {/* Outer frame */}
      <rect x="4" y="3" width="16" height="18" rx="1.5" strokeWidth={1.5} />
      {/* Thick top edge fill */}
      <rect
        x="4"
        y="3"
        width="16"
        height="4"
        rx="1.5"
        fill="currentColor"
        stroke="none"
      />
      {/* Thick bottom edge fill */}
      <rect
        x="4"
        y="17"
        width="16"
        height="4"
        rx="1.5"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

// Flow horizontal: two filled boxes side-by-side inside a wide frame
export function IconFlowHorizontal({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      {/* Outer container — wide landscape frame */}
      <rect x="2" y="6" width="20" height="12" rx="2" strokeWidth={1.5} />
      {/* Left item */}
      <rect
        x="5"
        y="9"
        width="5"
        height="6"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
      {/* Right item */}
      <rect
        x="14"
        y="9"
        width="5"
        height="6"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

// Flow vertical: two filled boxes stacked inside a tall frame
export function IconFlowVertical({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      {/* Outer container — tall portrait frame */}
      <rect x="6" y="2" width="12" height="20" rx="2" strokeWidth={1.5} />
      {/* Top item */}
      <rect
        x="9"
        y="5"
        width="6"
        height="5"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
      {/* Bottom item */}
      <rect
        x="9"
        y="14"
        width="6"
        height="5"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

// Flow wrap: items wrap to a new row (first row: two boxes, second row: one + arrow)
export function IconFlowWrap({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      {/* First row: two items */}
      <rect x="2" y="3" width="8" height="7" rx="1.5" strokeWidth={1.5} />
      <rect x="12" y="3" width="8" height="7" rx="1.5" strokeWidth={1.5} />
      {/* Second row: one item (wrapped) */}
      <rect x="2" y="12" width="8" height="7" rx="1.5" strokeWidth={1.5} />
      {/* Wrap return arrow — corner turn from right → down → left */}
      <polyline points="22,7 22,15 18,15" strokeWidth={1.5} />
      <polyline points="20,13 18,15 20,17" strokeWidth={1.5} />
    </svg>
  );
}

// Flow grid: 2×2 equal grid of boxes
export function IconFlowGrid({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      {/* Top-left */}
      <rect x="2" y="2" width="9" height="9" rx="1.5" strokeWidth={1.5} />
      {/* Top-right */}
      <rect x="13" y="2" width="9" height="9" rx="1.5" strokeWidth={1.5} />
      {/* Bottom-left */}
      <rect x="2" y="13" width="9" height="9" rx="1.5" strokeWidth={1.5} />
      {/* Bottom-right */}
      <rect x="13" y="13" width="9" height="9" rx="1.5" strokeWidth={1.5} />
    </svg>
  );
}

// Distribute horizontal: two vertical rail lines + center item + gap tick marks
export function IconDistributeHorizontal({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      {/* Left rail */}
      <line x1="3" y1="5" x2="3" y2="19" />
      {/* Right rail */}
      <line x1="21" y1="5" x2="21" y2="19" />
      {/* Center filled item */}
      <rect
        x="9"
        y="8"
        width="6"
        height="8"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
      {/* Gap tick marks — short vertical lines between rail and center */}
      <line x1="6" y1="10" x2="6" y2="14" strokeWidth={1.5} />
      <line x1="18" y1="10" x2="18" y2="14" strokeWidth={1.5} />
    </svg>
  );
}

// Distribute vertical: two horizontal rail lines + center item + gap tick marks
export function IconDistributeVertical({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      {/* Top rail */}
      <line x1="5" y1="3" x2="19" y2="3" />
      {/* Bottom rail */}
      <line x1="5" y1="21" x2="19" y2="21" />
      {/* Center filled item */}
      <rect
        x="8"
        y="9"
        width="8"
        height="6"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
      {/* Gap tick marks — short horizontal lines between rail and center */}
      <line x1="10" y1="6" x2="14" y2="6" strokeWidth={1.5} />
      <line x1="10" y1="18" x2="14" y2="18" strokeWidth={1.5} />
    </svg>
  );
}

// Layout settings / sliders: three horizontal tracks with thumb handles at different x positions
export function IconLayoutSettings({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      {/* Track 1 */}
      <line x1="3" y1="7" x2="21" y2="7" />
      {/* Handle 1 at ~x=8 */}
      <circle
        cx="8"
        cy="7"
        r="2.5"
        fill="var(--background, #1e1e1e)"
        strokeWidth={2}
      />
      {/* Track 2 */}
      <line x1="3" y1="12" x2="21" y2="12" />
      {/* Handle 2 at ~x=16 */}
      <circle
        cx="16"
        cy="12"
        r="2.5"
        fill="var(--background, #1e1e1e)"
        strokeWidth={2}
      />
      {/* Track 3 */}
      <line x1="3" y1="17" x2="21" y2="17" />
      {/* Handle 3 at ~x=11 */}
      <circle
        cx="11"
        cy="17"
        r="2.5"
        fill="var(--background, #1e1e1e)"
        strokeWidth={2}
      />
    </svg>
  );
}

// Resize to fit: four corner L-brackets pointing inward
export function IconResizeToFit({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      {/* Top-left corner: L pointing inward (→ and ↓) */}
      <polyline points="9,4 4,4 4,9" />
      {/* Top-right corner */}
      <polyline points="15,4 20,4 20,9" />
      {/* Bottom-left corner */}
      <polyline points="4,15 4,20 9,20" />
      {/* Bottom-right corner */}
      <polyline points="20,15 20,20 15,20" />
    </svg>
  );
}

// Auto-layout toggle "on" — rounded rectangle with two small boxes arranged in a row inside
// Matches Figma's blue auto-layout indicator glyph
export function IconAutoLayoutOn({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      {/* Outer rounded frame */}
      <rect x="2" y="5" width="20" height="14" rx="3" strokeWidth={1.5} />
      {/* Left inner item */}
      <rect
        x="5"
        y="8"
        width="5"
        height="8"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
      {/* Right inner item */}
      <rect
        x="12"
        y="8"
        width="7"
        height="8"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

// Paint type: solid fill swatch (filled square)
export function IconPaintSolid({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2.5"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

// Paint type: linear gradient (left-dark to right-light)
export function IconPaintLinear({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="lg-icon-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2.5"
        fill="url(#lg-icon-grad)"
        strokeWidth={1.5}
      />
    </svg>
  );
}

// Paint type: image fill (picture frame with mountain/sun)
export function IconPaintImage({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      {/* Frame */}
      <rect x="3" y="3" width="18" height="18" rx="2.5" strokeWidth={1.5} />
      {/* Mountain silhouette */}
      <polyline points="3,17 8,12 12,15 16,10 21,17" strokeWidth={1.5} />
      {/* Sun dot */}
      <circle cx="17" cy="8" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Paint type: none / no fill (square with diagonal slash)
export function IconPaintNone({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      {/* Square frame */}
      <rect x="3" y="3" width="18" height="18" rx="2.5" strokeWidth={1.5} />
      {/* Diagonal slash */}
      <line x1="5" y1="19" x2="19" y2="5" strokeWidth={1.5} />
    </svg>
  );
}

// Align left — lines left-aligned against a left rail
export function IconAlignLeft({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      <line x1="3" y1="4" x2="3" y2="20" />
      <line x1="6" y1="8" x2="18" y2="8" />
      <line x1="6" y1="12" x2="14" y2="12" />
      <line x1="6" y1="16" x2="16" y2="16" />
    </svg>
  );
}

// Align center horizontal
export function IconAlignCenterH({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="5" y1="8" x2="19" y2="8" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="6" y1="16" x2="18" y2="16" />
    </svg>
  );
}

// Align right
export function IconAlignRight({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      aria-hidden="true"
    >
      <line x1="21" y1="4" x2="21" y2="20" />
      <line x1="6" y1="8" x2="18" y2="8" />
      <line x1="10" y1="12" x2="18" y2="12" />
      <line x1="8" y1="16" x2="18" y2="16" />
    </svg>
  );
}
