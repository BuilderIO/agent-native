import { sendToAgentChat, useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import { IconMessage, IconSend, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface CanvasPin {
  id: string;
  /** Position as a percentage of the canvas (so it survives resize/zoom) */
  xPct: number;
  yPct: number;
  /** Optional CSS selector of the element under the click, for context */
  targetSelector?: string;
  /** Optional snippet of text content the user clicked near */
  targetText?: string;
  /** Pending comment text the user is composing */
  draft?: string;
  /** Submitted state — pin disappears once the agent acknowledges */
  submitted?: boolean;
}

const POPOVER_WIDTH = 288; // tailwind w-72
const POPOVER_HEIGHT_ESTIMATE = 200;
const POPOVER_GAP = 12;
const VIEWPORT_MARGIN = 16;

/** Right-anchored sidebar inset (e.g. the agent sidebar) so we don't slide the
 * composer underneath it. Mirrors the logic Pinpoint's toolbar uses. */
function getRightSidebarInset(): number {
  if (typeof window === "undefined" || typeof document === "undefined")
    return 0;
  let inset = 0;
  for (const panel of document.querySelectorAll<HTMLElement>(
    ".agent-sidebar-panel",
  )) {
    const style = window.getComputedStyle(panel);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      panel.getAttribute("aria-hidden") === "true"
    ) {
      continue;
    }
    const r = panel.getBoundingClientRect();
    const anchoredRight =
      r.width > 0 &&
      r.right >= window.innerWidth - 1 &&
      r.left < window.innerWidth - 1;
    if (!anchoredRight) continue;
    inset = Math.max(inset, Math.ceil(window.innerWidth - r.left));
  }
  return inset;
}

/** Compute popover offset relative to the pin anchor so the composer (and its
 * Send button) stays inside the visible viewport — even when the right side is
 * occluded by the agent sidebar. Without this the Send button drifts off the
 * right edge for pins dropped near the right of the slide and clicks land on
 * nothing. */
function computePopoverOffset(pinX: number, pinY: number) {
  if (typeof window === "undefined") {
    return { left: POPOVER_GAP, top: 4 };
  }
  const safeRight =
    window.innerWidth - getRightSidebarInset() - VIEWPORT_MARGIN;
  const safeBottom = window.innerHeight - VIEWPORT_MARGIN;

  let left = POPOVER_GAP;
  if (pinX + POPOVER_GAP + POPOVER_WIDTH > safeRight) {
    left = -POPOVER_WIDTH - POPOVER_GAP;
  }
  // After flipping, the popover's right edge could still spill into the
  // sidebar if the pin sits close to it. Slide further left so the whole
  // composer (including the Send button) stays inside the safe area.
  if (pinX + left + POPOVER_WIDTH > safeRight) {
    left = safeRight - pinX - POPOVER_WIDTH;
  }
  if (pinX + left < VIEWPORT_MARGIN) {
    left = VIEWPORT_MARGIN - pinX;
  }

  let top = 4;
  if (pinY + top + POPOVER_HEIGHT_ESTIMATE > safeBottom) {
    top = -POPOVER_HEIGHT_ESTIMATE - 4;
  }
  if (pinY + top < VIEWPORT_MARGIN) {
    top = VIEWPORT_MARGIN - pinY;
  }

  return { left, top };
}

interface CanvasCommentPinsProps {
  /** Whether the pin tool is active. When true, clicks drop pins. */
  active: boolean;
  /** Disable / exit the pin mode (called on Escape, after submit, etc.) */
  onClose: () => void;
  /**
   * Selector for the canvas surface (e.g. `.slide-content`). Pins are anchored
   * to this element's bounding rect; clicks outside are ignored.
   */
  canvasSelector: string;
  /** Stable identifier for the current view (slide id / design id) — used in
   * the agent prompt and as a pin namespace key. */
  contextId: string;
  /** Human-readable label for the context (slide title, slide index, design
   * title) used in the agent prompt. */
  contextLabel?: string;
}

/**
 * Click-to-comment pins anchored to the canvas.
 *
 * Mirrors claude.ai/design's "inline comments" feature — the most-praised
 * interaction pattern of that tool. A user clicks anywhere on the canvas to
 * drop a pin, types a one-line instruction, and the pin's position + nearby
 * element selector + instruction is sent to the agent. The pin disappears
 * once submitted; the agent's reply lands in the chat sidebar where it can
 * make targeted edits.
 *
 * Why pins (vs text-anchored comments):
 *   The existing slide_comments table anchors comments to text selections via
 *   TipTap. That's good for prose review — but Rochkind also wants to point
 *   to images, charts, and whitespace. Pins handle those cases without
 *   requiring a text selection.
 */
export function CanvasCommentPins({
  active,
  onClose,
  canvasSelector,
  contextId,
  contextLabel,
}: CanvasCommentPinsProps) {
  const t = useT();
  const [pins, setPins] = useState<CanvasPin[]>([]);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  // Reset pins when the context (slide) changes — they're scoped to one view.
  useEffect(() => {
    setPins([]);
    setActivePinId(null);
  }, [contextId]);

  // Find the canvas container the pins overlay. The canvas can take a few
  // frames to land in the DOM after a slide change — retry until we find
  // it so the click handler isn't permanently stuck on a stale (or null)
  // ref when the user navigates between slides with pin mode active.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let attempts = 0;
    const findCanvas = () => {
      if (cancelled) return;
      const el = document.querySelector(canvasSelector) as HTMLElement | null;
      if (el) {
        containerRef.current = el;
        return;
      }
      if (attempts++ < 30) {
        setTimeout(findCanvas, 50);
      }
    };
    findCanvas();
    return () => {
      cancelled = true;
    };
  }, [active, canvasSelector, contextId]);

  // Click handler — drops a pin where the user clicks the canvas
  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      const canvas = containerRef.current;
      if (!canvas) return;
      const target = e.target as HTMLElement;

      // Ignore clicks on UI chrome (the pin popovers themselves)
      if (target.closest("[data-pin-popover]")) return;
      if (!canvas.contains(target)) return;

      const rect = canvas.getBoundingClientRect();
      const xPct = ((e.clientX - rect.left) / rect.width) * 100;
      const yPct = ((e.clientY - rect.top) / rect.height) * 100;

      // Build a best-effort selector for the target element (data-builder-id
      // is stamped by SlideEditor for slides, similar markers exist in design)
      let targetSelector: string | undefined;
      const builderId = target
        .closest("[data-builder-id]")
        ?.getAttribute("data-builder-id");
      if (builderId) targetSelector = `[data-builder-id="${builderId}"]`;

      const targetText = target.textContent?.trim().slice(0, 80) || undefined;

      const newPin: CanvasPin = {
        id: crypto.randomUUID(),
        xPct,
        yPct,
        targetSelector,
        targetText,
        draft: "",
      };
      setPins((prev) => [...prev, newPin]);
      setActivePinId(newPin.id);
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("click", onClick, { capture: true });
    return () =>
      window.removeEventListener("click", onClick, { capture: true });
  }, [active]);

  // Escape closes pin mode
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);

  const updatePin = (id: string, updates: Partial<CanvasPin>) => {
    setPins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    );
  };

  const removePin = (id: string) => {
    setPins((prev) => prev.filter((p) => p.id !== id));
    if (activePinId === id) setActivePinId(null);
  };

  const submitPin = (pin: CanvasPin) => {
    const text = (pin.draft || "").trim();
    if (!text) {
      removePin(pin.id);
      return;
    }
    const lines = [
      `[Comment pin on ${contextLabel || contextId}]`,
      `Position: ${pin.xPct.toFixed(1)}% from left, ${pin.yPct.toFixed(1)}% from top`,
    ];
    if (pin.targetSelector) lines.push(`Element: ${pin.targetSelector}`);
    if (pin.targetText) lines.push(`Nearby text: "${pin.targetText}"`);
    lines.push("");
    lines.push(text);
    try {
      // Use `sendToAgentChat` (not the shared `agentChat.submit`) so the
      // request routes correctly when slides is embedded in Builder/Frame
      // (the Builder parent ignores `agentNative.submitChat` — the wrapped
      // helper falls back to posting to self in that case) and so the agent
      // sidebar is reliably opened via the `agent-panel:open` custom event
      // even if the user has it collapsed.
      sendToAgentChat({
        message: lines.join("\n"),
        submit: true,
        openSidebar: true,
      });
    } catch (err) {
      console.error("[CanvasCommentPins] failed to send to agent:", err);
    }
    updatePin(pin.id, { submitted: true });
    // Auto-clear after a short delay so the user sees the pin "fly away"
    setTimeout(() => removePin(pin.id), 1500);
  };

  if (!active && pins.length === 0) return null;

  // Render pins as portaled overlays positioned on top of the canvas
  const canvas = containerRef.current;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();

  return (
    <>
      {/* Cursor hint banner — only when pin mode is active */}
      {active && (
        <div
          data-pin-mode-banner
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full border border-border bg-popover px-3 py-1.5 shadow-lg pointer-events-none"
        >
          <IconMessage className="w-3.5 h-3.5 text-[#609FF8]" />
          <span className="text-[11px] text-foreground">
            {t("raw.pinDropHint")}
          </span>
          <span className="text-[10px] text-muted-foreground ml-1">
            {t("raw.escExit")}
          </span>
        </div>
      )}

      {/* Pin overlays */}
      {pins.map((pin) => {
        const left = rect.left + (pin.xPct / 100) * rect.width;
        const top = rect.top + (pin.yPct / 100) * rect.height;
        const isActive = activePinId === pin.id;
        return (
          <div
            key={pin.id}
            data-pin-popover
            data-pin-id={pin.id}
            className={cn(
              "fixed z-[55]",
              pin.submitted &&
                "transition-all duration-1000 opacity-0 -translate-y-4",
            )}
            style={{ left, top }}
          >
            {/* Pin marker. The tooltip is suppressed while the composer is
             * open: the textarea already shows the same draft text, and a
             * shadcn TooltipContent (z-[250], no `pointer-events: none`) was
             * intercepting Send-button clicks for pins near the top of the
             * slide where Radix auto-flips the tooltip below the trigger and
             * onto the composer. */}
            <Tooltip open={isActive ? false : undefined}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActivePinId(pin.id)}
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-full -mt-1 flex items-center justify-center w-7 h-7 rounded-full rounded-bl-none shadow-lg cursor-pointer",
                    "bg-[#609FF8] text-black hover:scale-110 transition-transform",
                  )}
                >
                  <IconMessage className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="pointer-events-none">
                {pin.draft || "Comment"}
              </TooltipContent>
            </Tooltip>

            {/* Inline composer. z-[260] keeps it above the shadcn floating-UI
             * tier (z-[250] — Tooltip, Popover, Dialog overlay, etc.) so a
             * stray tooltip that pops over the pin can't swallow Send clicks. */}
            {isActive && !pin.submitted && (
              <div
                data-pin-popover
                className="absolute z-[260] w-72 rounded-lg border border-border bg-popover shadow-xl p-2"
                style={(() => {
                  const off = computePopoverOffset(left, top);
                  return { left: off.left, top: off.top };
                })()}
              >
                <p className="mb-2 text-xs font-semibold text-foreground">
                  {t("raw.editSlide")}
                </p>
                <Textarea
                  autoFocus
                  value={pin.draft || ""}
                  onChange={(e) => updatePin(pin.id, { draft: e.target.value })}
                  onKeyDown={(e) => {
                    // Backspace / Delete must stay inside the textarea — the
                    // global DeckEditor handler treats them as "delete current
                    // slide" when the canvas has focus, and any focus race
                    // (e.g. autoFocus not yet landed, popover unmount during
                    // submit) would otherwise blow away the slide the user is
                    // commenting on. Stop at the source.
                    e.stopPropagation();
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      submitPin(pin);
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      removePin(pin.id);
                    }
                  }}
                  placeholder={t("raw.tellAgentChange")}
                  className="resize-none text-xs min-h-[60px]"
                />
                {pin.targetText && (
                  <div className="text-[10px] text-muted-foreground mt-1 italic line-clamp-1">
                    near "{pin.targetText}"
                  </div>
                )}
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-muted-foreground">
                    {/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"}
                    +Enter to submit
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px] cursor-pointer"
                      onClick={() => removePin(pin.id)}
                    >
                      <IconX className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      className="h-6 gap-1 px-2 text-[10px] cursor-pointer"
                      onClick={() => submitPin(pin)}
                      disabled={!(pin.draft || "").trim()}
                    >
                      <IconSend className="w-3 h-3" />
                      Send
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
