import { IconSparkles } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import type { CanvasAgentState } from "../../pages/design-editor/canvas-agent-state";
import { placeAffordance } from "../../pages/design-editor/selection-affordance-placement";

export interface SelectionAgentAffordanceProps {
  /** The selection rect in the SAME coordinate space as `containerRect` (viewport px). null hides the affordance. */
  anchorRect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } | null;
  /** Bounding rect of the canvas container the affordance is positioned within (from containerRef.getBoundingClientRect()). */
  containerRect: { width: number; height: number } | null;
  /** Re-key signal: changes whenever zoom/pan/scroll/layout changes so the parent forces a reposition. Optional. */
  layoutTick?: number;
  /** Hide entirely (pin mode, text editing, drag in progress, pending questions). */
  suppressed?: boolean;
  /** Fired when the user clicks "Change this…" (opens composer for a mutation). */
  onChange: () => void;
  /** Fired when the user clicks "Ask about this" (read-only question). */
  onAsk: () => void;
  /** Optional current canvas agent state to show as a small status dot on the chip. */
  agentState?: CanvasAgentState;
}

const DEFAULT_CHIP_SIZE = { width: 176, height: 32 };
const CLOSE_DELAY_MS = 300;

interface StatusDot {
  spinner: boolean;
  dotClass: string;
  title: string;
}

function statusDot(state: CanvasAgentState): StatusDot | null {
  switch (state) {
    case "working":
      return {
        spinner: true,
        dotClass: "",
        title: "Agent is working" /* i18n-ignore */,
      };
    case "applying":
      return {
        spinner: true,
        dotClass: "",
        title: "Applying changes" /* i18n-ignore */,
      };
    case "needs-answer":
      return {
        spinner: false,
        dotClass: "bg-amber-500",
        title: "Agent needs an answer" /* i18n-ignore */,
      };
    case "warning":
      return {
        spinner: false,
        dotClass: "bg-amber-500",
        title: "Agent is offline" /* i18n-ignore */,
      };
    case "done":
      return {
        spinner: false,
        dotClass: "bg-emerald-500",
        title: "Agent finished" /* i18n-ignore */,
      };
    case "failed":
      return {
        spinner: false,
        dotClass: "bg-red-500",
        title: "Agent failed" /* i18n-ignore */,
      };
    default:
      return null;
  }
}

function anchorSignature(
  rect: SelectionAgentAffordanceProps["anchorRect"],
): string {
  if (!rect) return "none";
  return `${rect.left},${rect.top},${rect.right},${rect.bottom}`;
}

export function SelectionAgentAffordance({
  anchorRect,
  containerRect,
  layoutTick = 0,
  suppressed = false,
  onChange,
  onAsk,
  agentState,
}: SelectionAgentAffordanceProps) {
  const chipRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chipSize, setChipSize] = useState(DEFAULT_CHIP_SIZE);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [hidden, setHidden] = useState(false);

  const signature = anchorSignature(anchorRect);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHidden(true), CLOSE_DELAY_MS);
  }, [cancelClose]);

  // A fresh selection re-shows the chip immediately and cancels any pending close.
  useEffect(() => {
    cancelClose();
    setHidden(false);
  }, [signature, cancelClose]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  useLayoutEffect(() => {
    const element = chipRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setChipSize((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hidden]);

  useLayoutEffect(() => {
    if (!anchorRect || !containerRect) {
      setPosition(null);
      return;
    }
    const placement = placeAffordance(anchorRect, containerRect, chipSize);
    setPosition((current) =>
      current &&
      current.left === placement.left &&
      current.top === placement.top
        ? current
        : { left: placement.left, top: placement.top },
    );
  }, [anchorRect, containerRect, chipSize, layoutTick]);

  if (suppressed || !anchorRect || !containerRect || hidden) {
    return null;
  }

  const dot = agentState ? statusDot(agentState) : null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        ref={chipRef}
        data-selection-agent-affordance=""
        className="pointer-events-auto absolute flex items-center gap-0.5 rounded-full border border-border bg-popover p-0.5 shadow-lg"
        style={{ left: position?.left ?? 0, top: position?.top ?? 0 }}
        onPointerEnter={cancelClose}
        onPointerLeave={scheduleClose}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setHidden(true);
          }
        }}
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setHidden(true);
          }
        }}
      >
        <span
          aria-hidden="true"
          className="flex size-6 items-center justify-center text-muted-foreground"
        >
          <IconSparkles className="size-3.5" />
        </span>
        <Button
          type="button"
          size="sm"
          className="h-6 gap-1 rounded-full px-2.5 text-[11px]"
          aria-label={"Change this element with the agent" /* i18n-ignore */}
          onClick={onChange}
        >
          Change this…{/* i18n-ignore */}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 rounded-full px-2 text-[11px]"
          aria-label={"Ask about this element" /* i18n-ignore */}
          onClick={onAsk}
        >
          Ask about this{/* i18n-ignore */}
        </Button>
        {dot ? (
          <span
            role="status"
            title={dot.title}
            aria-label={dot.title}
            className="flex size-4 items-center justify-center"
          >
            {dot.spinner ? (
              <Spinner className="size-3 text-blue-500" />
            ) : (
              <span className={cn("size-2 rounded-full", dot.dotClass)} />
            )}
          </span>
        ) : null}
      </div>
    </div>
  );
}
