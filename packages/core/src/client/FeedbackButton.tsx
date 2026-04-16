import { useState, useEffect, useRef, type CSSProperties } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { IconMessage2, IconCheck } from "@tabler/icons-react";
import { cn } from "./utils.js";

const DEFAULT_FEEDBACK_URL =
  "https://forms.agent-native.com/f/agent-native-feedback/_16ewV";

function getExpectedOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export interface FeedbackButtonProps {
  /**
   * "sidebar" renders a full-width row with icon + label (for app left sidebars).
   * "icon" renders a small icon-only button (for dense toolbars, e.g. the agent panel header).
   */
  variant?: "sidebar" | "icon";
  label?: string;
  url?: string;
  className?: string;
  /** Which side the popover opens on. Defaults match the variant. */
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}

const surfaceStyle: CSSProperties = {
  width: "min(440px, calc(100vw - 32px))",
  height: "min(320px, calc(100vh - 120px))",
  background: "hsl(var(--background))",
};

function FeedbackSkeleton() {
  return (
    <div className="flex h-full w-full flex-col gap-4 p-5" aria-hidden>
      <div className="flex flex-col gap-2">
        <div className="h-4 w-40 rounded bg-muted animate-pulse" />
        <div className="h-3 w-56 rounded bg-muted/70 animate-pulse" />
      </div>
      <div className="flex flex-col gap-3 pt-2">
        <div className="h-3 w-24 rounded bg-muted animate-pulse" />
        <div className="h-9 w-full rounded-md bg-muted animate-pulse" />
      </div>
      <div className="flex flex-col gap-3">
        <div className="h-3 w-28 rounded bg-muted animate-pulse" />
        <div className="h-20 w-full rounded-md bg-muted animate-pulse" />
      </div>
      <div className="mt-auto flex justify-end">
        <div className="h-9 w-24 rounded-md bg-muted animate-pulse" />
      </div>
    </div>
  );
}

function FeedbackThanks() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
        <IconCheck size={22} stroke={2.5} />
      </div>
      <div className="text-sm font-medium text-foreground">
        Thanks for the feedback!
      </div>
      <div className="text-xs text-muted-foreground">
        We read every submission.
      </div>
    </div>
  );
}

export function FeedbackButton({
  variant = "sidebar",
  label = "Feedback",
  url = DEFAULT_FEEDBACK_URL,
  className,
  side,
  align = "end",
}: FeedbackButtonProps) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const embedUrl = url.includes("?") ? `${url}&embed=1` : `${url}?embed=1`;
  const expectedOrigin = getExpectedOrigin(embedUrl);

  // Reset transient state each time the popover opens so the skeleton shows
  // on the next open and a stale "submitted" view doesn't leak across sessions.
  useEffect(() => {
    if (open) {
      setLoaded(false);
      setSubmitted(false);
    }
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onMessage(e: MessageEvent) {
      if (expectedOrigin && e.origin !== expectedOrigin) return;
      const type = e.data && e.data.type;
      if (type === "agent-native-feedback-close") {
        setOpen(false);
      } else if (type === "agent-native-feedback-submitted") {
        setSubmitted(true);
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        closeTimerRef.current = setTimeout(() => setOpen(false), 1600);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open, expectedOrigin]);

  const trigger =
    variant === "icon" ? (
      <TooltipPrimitive.Provider delayDuration={200}>
        <TooltipPrimitive.Root>
          <TooltipPrimitive.Trigger asChild>
            <PopoverPrimitive.Trigger asChild>
              <button
                type="button"
                aria-label={label}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50",
                  className,
                )}
              >
                <IconMessage2 size={14} />
              </button>
            </PopoverPrimitive.Trigger>
          </TooltipPrimitive.Trigger>
          <TooltipPrimitive.Portal>
            <TooltipPrimitive.Content
              sideOffset={6}
              className="z-[230] overflow-hidden rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-foreground shadow-md"
            >
              {label}
            </TooltipPrimitive.Content>
          </TooltipPrimitive.Portal>
        </TooltipPrimitive.Root>
      </TooltipPrimitive.Provider>
    ) : (
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
            className,
          )}
        >
          <IconMessage2 className="h-4 w-4" />
          <span>{label}</span>
        </button>
      </PopoverPrimitive.Trigger>
    );

  const resolvedSide = side ?? (variant === "icon" ? "bottom" : "top");

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      {trigger}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={resolvedSide}
          align={align}
          sideOffset={8}
          collisionPadding={16}
          className="z-[300] overflow-hidden rounded-lg border border-border bg-popover shadow-xl outline-none"
        >
          <div className="relative" style={surfaceStyle}>
            <iframe
              title="Feedback form"
              src={embedUrl}
              sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              onLoad={() => setLoaded(true)}
              className={cn(
                "absolute inset-0 block h-full w-full border-0 transition-opacity duration-200",
                loaded && !submitted ? "opacity-100" : "opacity-0",
              )}
            />
            {!loaded && !submitted && (
              <div className="absolute inset-0">
                <FeedbackSkeleton />
              </div>
            )}
            {submitted && (
              <div className="absolute inset-0 bg-popover">
                <FeedbackThanks />
              </div>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
