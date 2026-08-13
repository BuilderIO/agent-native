import type { KeyboardEvent, MouseEvent, ReactNode, Ref } from "react";

import { cn } from "@/lib/utils";

export interface TranscriptSegmentRowProps {
  startMs: number;
  children: ReactNode;
  active?: boolean;
  /** Momentary jump-to-segment flash, rendered as its own overlay layer so
   * its fade-out is never racing the row's own hover/active transition. */
  highlighted?: boolean;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  segmentRef?: Ref<HTMLDivElement>;
  tabIndex?: number;
  gutter?: "content" | "panel";
  className?: string;
}

export function formatTranscriptTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function TranscriptSegmentRow({
  startMs,
  children,
  active = false,
  highlighted = false,
  onClick,
  onKeyDown,
  segmentRef,
  tabIndex,
  gutter = "content",
  className,
}: TranscriptSegmentRowProps) {
  const interactive = Boolean(onClick);
  const rowTabIndex = tabIndex ?? (interactive ? 0 : undefined);
  const isFocusable = rowTabIndex !== undefined;

  return (
    <div
      ref={segmentRef}
      role={interactive ? "button" : isFocusable ? "group" : undefined}
      tabIndex={rowTabIndex}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        "group/segment relative flex items-baseline gap-4 rounded-md py-1.5 text-left text-sm leading-normal text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        gutter === "content" ? "-mx-2 px-2" : "w-full px-3",
        interactive && "cursor-pointer",
        active && "bg-accent",
        interactive && !active && "hover:bg-accent/50",
        className,
      )}
    >
      {/* Overlay, not a shared background class — its own opacity fade can't
          be raced by the row's hover/active transition (see highlighted prop). */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 rounded-md bg-yellow-400/15 transition-opacity ease-out",
          highlighted ? "opacity-100 duration-200" : "opacity-0 duration-700",
        )}
      />
      <span className="min-w-0 flex-1 whitespace-pre-wrap">{children}</span>
      <span className="pointer-events-none w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground/80 opacity-0 transition-opacity group-hover/segment:opacity-100 group-focus-visible/segment:opacity-100 [@media(hover:none)]:opacity-100">
        {formatTranscriptTimestamp(startMs)}
      </span>
    </div>
  );
}
