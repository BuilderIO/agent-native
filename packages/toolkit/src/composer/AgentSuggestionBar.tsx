import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";

import { Button } from "../ui/button.js";
import { Skeleton } from "../ui/skeleton.js";
import { cn } from "../utils.js";

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface AgentSuggestionItem {
  id: string;
  label: string;
  prompt?: string;
  disabled?: boolean;
  metadata?: Readonly<Record<string, unknown>>;
}

export type AgentSuggestionInput = string | AgentSuggestionItem;

export interface AgentSuggestionBarProps {
  suggestions: readonly AgentSuggestionInput[];
  ariaLabel: string;
  /** Visible label above the chips; it also names the group. */
  title?: string;
  onSelect: (suggestion: AgentSuggestionItem) => void;
  renderSuggestion?: (suggestion: AgentSuggestionItem) => ReactNode;
  className?: string;
  loading?: boolean;
  announceUpdates?: boolean;
  layout?: "wrap" | "single-line";
}

export function normalizeAgentSuggestion(
  suggestion: AgentSuggestionInput,
  index: number,
): AgentSuggestionItem {
  if (typeof suggestion !== "string") return suggestion;
  return {
    id: `suggestion-${index}-${suggestion}`,
    label: suggestion,
    prompt: suggestion,
  };
}

export function agentSuggestionPrompt(
  suggestion: AgentSuggestionInput,
): string {
  return typeof suggestion === "string"
    ? suggestion
    : (suggestion.prompt ?? suggestion.label);
}

function twoLineTrackWidth(widths: readonly number[], gap: number): number {
  const total =
    widths.reduce((sum, width) => sum + width, 0) +
    gap * Math.max(widths.length - 1, 0);
  let narrowest = total;
  let firstLine = -gap;
  for (const width of widths.slice(0, -1)) {
    firstLine += gap + width;
    narrowest = Math.min(
      narrowest,
      Math.max(firstLine, total - firstLine - gap),
    );
  }
  return narrowest;
}

// Chrome does not scroll a partly visible chip into view when it takes
// keyboard focus, which leaves it under the edge fade. Listen on the track:
// a host's ActionButton adapter receives only the props Button forwards, and
// onFocus is not one of them.
function revealKeyboardFocusedChip(event: FocusEvent<HTMLDivElement>) {
  const chip = event.target;
  if (!(chip instanceof HTMLElement) || !chip.matches(":focus-visible")) return;
  chip.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function useTwoLineSuggestionTrack(layoutKey: string) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  useBrowserLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    if (!scroller || !track) return;
    const chips = Array.from(track.children);
    const updateOverflow = () => {
      const offset = Math.abs(scroller.scrollLeft);
      const start = offset > 1;
      const end = offset + scroller.clientWidth < scroller.scrollWidth - 1;
      setOverflow((current) =>
        current.start === start && current.end === end
          ? current
          : { start, end },
      );
    };
    const update = () => {
      const gap = Number.parseFloat(getComputedStyle(track).columnGap);
      const width = twoLineTrackWidth(
        chips.map((chip) => chip.getBoundingClientRect().width),
        Number.isNaN(gap) ? 0 : gap,
      );
      track.style.setProperty(
        "--agent-suggestion-track-width",
        `${Math.ceil(width)}px`,
      );
      updateOverflow();
    };
    update();

    // Resizing the track inside the observer callback resizes the observed
    // scroller in the same frame, which the browser reports as a
    // ResizeObserver loop error. Measure on the next frame instead.
    let frame = 0;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(update);
          });
    observer?.observe(scroller);
    for (const chip of chips) observer?.observe(chip);
    scroller.addEventListener("scroll", updateOverflow, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      scroller.removeEventListener("scroll", updateOverflow);
    };
  }, [layoutKey]);

  return { scrollerRef, trackRef, overflow };
}

export function AgentSuggestionBar({
  suggestions,
  ariaLabel,
  title,
  onSelect,
  renderSuggestion,
  className,
  loading = false,
  announceUpdates = false,
  layout = "wrap",
}: AgentSuggestionBarProps) {
  const titleId = useId();
  const items = suggestions.map(normalizeAgentSuggestion);
  const { scrollerRef, trackRef, overflow } = useTwoLineSuggestionTrack(
    loading ? "loading" : items.map((item) => item.id).join("\n"),
  );
  if (!loading && items.length === 0) return null;

  return (
    <section
      aria-label={title ? undefined : ariaLabel}
      aria-labelledby={title ? titleId : undefined}
      aria-busy={loading || undefined}
      aria-live={announceUpdates ? "polite" : undefined}
      data-agent-suggestion-bar="true"
      className={cn("w-full min-w-0 overflow-hidden px-3 py-2", className)}
    >
      {title ? (
        <p
          id={titleId}
          data-agent-suggestion-title="true"
          className="agent-kit-caption-copy mb-1.5 px-0.5 text-muted-foreground"
        >
          {title}
        </p>
      ) : null}
      <div
        ref={scrollerRef}
        data-agent-suggestion-scroller="true"
        data-overflow-start={overflow.start || undefined}
        data-overflow-end={overflow.end || undefined}
        className="w-full min-w-0 snap-x snap-proximity scroll-px-6 overflow-x-auto overscroll-x-contain px-0.5 py-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div
          ref={trackRef}
          data-agent-suggestion-track="true"
          className={cn(
            "flex min-w-full gap-[var(--agent-suggestion-gap,0.25rem)]",
            layout === "single-line" || loading
              ? "h-6 w-max flex-nowrap items-center"
              : "w-(--agent-suggestion-track-width) flex-wrap",
          )}
          onFocus={revealKeyboardFocusedChip}
        >
          {loading
            ? ["w-32", "w-24", "w-28"].map((width, index) => (
                <Skeleton
                  key={index}
                  aria-hidden="true"
                  data-agent-suggestion-placeholder="true"
                  className={cn("h-6 shrink-0 rounded-full", width)}
                />
              ))
            : items.map((suggestion) => (
                <Button
                  key={suggestion.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={suggestion.disabled}
                  onClick={() => onSelect(suggestion)}
                  data-agent-suggestion-chip="true"
                  // The scroller clips overflow, so the focus ring sits inside.
                  className="agent-kit-caption-copy h-6 shrink-0 snap-start whitespace-nowrap rounded-full border border-border bg-transparent px-2.5 font-normal text-foreground shadow-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-inset focus-visible:ring-offset-0"
                >
                  <span>
                    {renderSuggestion
                      ? renderSuggestion(suggestion)
                      : suggestion.label}
                  </span>
                </Button>
              ))}
        </div>
      </div>
    </section>
  );
}
