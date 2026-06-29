import { cn } from "@/lib/utils";

interface IconProps {
  className?: string;
}

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
      {/* Left bracket ]  */}
      <line x1="8" y1="6" x2="4" y2="6" />
      <line x1="4" y1="6" x2="4" y2="18" />
      <line x1="4" y1="18" x2="8" y2="18" />
      {/* Center dot */}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      {/* Right bracket [ */}
      <line x1="16" y1="6" x2="20" y2="6" />
      <line x1="20" y1="6" x2="20" y2="18" />
      <line x1="20" y1="18" x2="16" y2="18" />
    </svg>
  );
}

export function IconPaddingHorizontal({ className }: IconProps) {
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
      {/* Outer frame */}
      <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5" />
      {/* Thick left side */}
      <line
        x1="3"
        y1="3"
        x2="3"
        y2="21"
        strokeWidth="4"
        strokeLinecap="square"
      />
      {/* Thick right side */}
      <line
        x1="21"
        y1="3"
        x2="21"
        y2="21"
        strokeWidth="4"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function IconPaddingVertical({ className }: IconProps) {
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
      {/* Outer frame */}
      <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5" />
      {/* Thick top side */}
      <line
        x1="3"
        y1="3"
        x2="21"
        y2="3"
        strokeWidth="4"
        strokeLinecap="square"
      />
      {/* Thick bottom side */}
      <line
        x1="3"
        y1="21"
        x2="21"
        y2="21"
        strokeWidth="4"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function IconFlowHorizontal({ className }: IconProps) {
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
      {/* Container frame */}
      <rect x="2" y="7" width="20" height="10" rx="2" strokeWidth="1.5" />
      {/* Left item */}
      <rect
        x="5"
        y="10"
        width="5"
        height="4"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
      {/* Right item */}
      <rect
        x="14"
        y="10"
        width="5"
        height="4"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

export function IconFlowVertical({ className }: IconProps) {
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
      {/* Container frame */}
      <rect x="7" y="2" width="10" height="20" rx="2" strokeWidth="1.5" />
      {/* Top item */}
      <rect
        x="10"
        y="5"
        width="4"
        height="5"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
      {/* Bottom item */}
      <rect
        x="10"
        y="14"
        width="4"
        height="5"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

export function IconFlowWrap({ className }: IconProps) {
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
      {/* First row: two items */}
      <rect x="2" y="4" width="8" height="7" rx="1.5" strokeWidth="1.5" />
      <rect x="12" y="4" width="8" height="7" rx="1.5" strokeWidth="1.5" />
      {/* Second row: one item (wrap) */}
      <rect x="2" y="13" width="8" height="7" rx="1.5" strokeWidth="1.5" />
      {/* Wrap arrow */}
      <polyline points="20,16 20,19 17,19" strokeWidth="1.5" />
    </svg>
  );
}

export function IconFlowGrid({ className }: IconProps) {
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
      {/* Top-left */}
      <rect x="2" y="2" width="9" height="9" rx="1.5" strokeWidth="1.5" />
      {/* Top-right */}
      <rect x="13" y="2" width="9" height="9" rx="1.5" strokeWidth="1.5" />
      {/* Bottom-left */}
      <rect x="2" y="13" width="9" height="9" rx="1.5" strokeWidth="1.5" />
      {/* Bottom-right */}
      <rect x="13" y="13" width="9" height="9" rx="1.5" strokeWidth="1.5" />
    </svg>
  );
}

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
      {/* Center item */}
      <rect
        x="9"
        y="9"
        width="6"
        height="6"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
      {/* Spacing tick marks */}
      <line x1="6" y1="10" x2="6" y2="14" strokeWidth="1.5" />
      <line x1="18" y1="10" x2="18" y2="14" strokeWidth="1.5" />
    </svg>
  );
}

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
      {/* Center item */}
      <rect
        x="9"
        y="9"
        width="6"
        height="6"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
      {/* Spacing tick marks */}
      <line x1="10" y1="6" x2="14" y2="6" strokeWidth="1.5" />
      <line x1="10" y1="18" x2="14" y2="18" strokeWidth="1.5" />
    </svg>
  );
}

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
      {/* Line 1 with handle at x=8 */}
      <line x1="3" y1="7" x2="21" y2="7" />
      <circle
        cx="8"
        cy="7"
        r="2"
        fill="var(--background, white)"
        strokeWidth="2"
      />
      {/* Line 2 with handle at x=15 */}
      <line x1="3" y1="12" x2="21" y2="12" />
      <circle
        cx="15"
        cy="12"
        r="2"
        fill="var(--background, white)"
        strokeWidth="2"
      />
      {/* Line 3 with handle at x=10 */}
      <line x1="3" y1="17" x2="21" y2="17" />
      <circle
        cx="10"
        cy="17"
        r="2"
        fill="var(--background, white)"
        strokeWidth="2"
      />
    </svg>
  );
}

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
      {/* Inner content box */}
      <rect x="8" y="8" width="8" height="8" rx="1" strokeWidth="1.5" />
      {/* Top-left corner arrows */}
      <polyline points="4,8 4,4 8,4" />
      {/* Top-right corner arrows */}
      <polyline points="16,4 20,4 20,8" />
      {/* Bottom-left corner arrows */}
      <polyline points="8,20 4,20 4,16" />
      {/* Bottom-right corner arrows */}
      <polyline points="20,16 20,20 16,20" />
    </svg>
  );
}
