import { useState, useEffect, type CSSProperties } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { IconMessage2 } from "@tabler/icons-react";
import { cn } from "./utils.js";

const DEFAULT_FEEDBACK_URL =
  "https://forms.agent-native.com/f/agent-native-feedback/_16ewV";

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

const iframeWrapStyle: CSSProperties = {
  width: "min(440px, calc(100vw - 32px))",
  height: "min(320px, calc(100vh - 120px))",
  background: "hsl(var(--background))",
};

export function FeedbackButton({
  variant = "sidebar",
  label = "Feedback",
  url = DEFAULT_FEEDBACK_URL,
  className,
  side,
  align = "end",
}: FeedbackButtonProps) {
  const [open, setOpen] = useState(false);
  const embedUrl = url.includes("?") ? `${url}&embed=1` : `${url}?embed=1`;

  useEffect(() => {
    if (!open) return;
    function onMessage(e: MessageEvent) {
      if (e.data && e.data.type === "agent-native-feedback-close") {
        setOpen(false);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open]);

  const trigger =
    variant === "icon" ? (
      <TooltipPrimitive.Root delayDuration={200}>
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
          <iframe
            title="Feedback form"
            src={embedUrl}
            style={iframeWrapStyle}
            className="block border-0"
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
