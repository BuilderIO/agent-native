import { sendToAgentChat, useT } from "@agent-native/core/client";
import {
  IconMessage,
  IconMessageCheck,
  IconSend,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  /** Submitted state — the marker stays visible as confirmation. */
  submitted?: boolean;
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
 * element selector + instruction is sent to the agent. Submitted pins stay on
 * the canvas as local confirmation; the agent's reply lands in the chat
 * sidebar where it can make targeted edits.
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
  const [canvasEl, setCanvasEl] = useState<HTMLElement | null>(null);

  // Reset pins when the context (slide) changes — they're scoped to one view.
  useEffect(() => {
    setPins([]);
    setActivePinId(null);
    setCanvasEl(null);
  }, [contextId]);

  // Find the canvas container the pins overlay
  useEffect(() => {
    if (!active) return;
    const findCanvas = () => {
      const el = document.querySelector(canvasSelector) as HTMLElement | null;
      if (el) {
        containerRef.current = el;
        setCanvasEl(el);
      }
    };
    findCanvas();
    const t = setTimeout(findCanvas, 50);
    return () => clearTimeout(t);
  }, [active, canvasSelector, contextId]);

  const dropPinAt = useCallback(
    (clientX: number, clientY: number, target?: HTMLElement | null) => {
      const canvas = containerRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const xPct = ((clientX - rect.left) / rect.width) * 100;
      const yPct = ((clientY - rect.top) / rect.height) * 100;
      if (xPct < 0 || xPct > 100 || yPct < 0 || yPct > 100) return; // i18n-ignore geometry bounds check, not UI copy

      // Build a best-effort selector for parent-DOM canvases. For iframe
      // canvases the transparent overlay captures the click, so target details
      // are intentionally omitted but the precise position is preserved.
      let targetSelector: string | undefined;
      const builderId = target
        ?.closest("[data-builder-id]")
        ?.getAttribute("data-builder-id");
      if (builderId) targetSelector = `[data-builder-id="${builderId}"]`;

      const targetText = target?.textContent?.trim().slice(0, 80) || undefined;

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
    },
    [],
  );

  // Click handler — drops a pin where the user clicks a non-iframe canvas.
  // Iframe canvases cannot bubble clicks to the parent, so the rendered
  // transparent overlay below handles those reliably.
  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      const canvas = containerRef.current;
      if (!canvas) return;
      const target = e.target as HTMLElement;

      // Ignore clicks on UI chrome (the pin popovers themselves)
      if (target.closest("[data-pin-popover]")) return;
      if (target.closest("[data-pin-click-overlay]")) return;
      if (!canvas.contains(target)) return;
      dropPinAt(e.clientX, e.clientY, target);
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("click", onClick, { capture: true });
    return () =>
      window.removeEventListener("click", onClick, { capture: true });
  }, [active, dropPinAt]);

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
      // request routes correctly when design is embedded in Builder/Frame
      // and so the agent sidebar is reliably opened via the `agent-panel:open`
      // custom event even if the user has it collapsed.
      sendToAgentChat({
        message: lines.join("\n"),
        submit: true,
        openSidebar: true,
      });
    } catch (err) {
      console.error("[CanvasCommentPins] failed to send to agent:", err);
    }
    updatePin(pin.id, { submitted: true });
    setActivePinId(null);
  };

  if (!active && pins.length === 0) return null;

  // Render pins as portaled overlays positioned on top of the canvas
  const canvas = containerRef.current ?? canvasEl;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();

  return (
    <>
      {/* Parent-side click plane. This is what makes iframe canvases commentable:
          clicks inside an iframe never bubble to the parent document. */}
      {active && (
        <div
          data-pin-click-overlay
          className="fixed z-[54] cursor-crosshair"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dropPinAt(e.clientX, e.clientY);
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        />
      )}

      {/* Cursor hint banner — only when pin mode is active */}
      {active && (
        <div
          data-pin-mode-banner
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full border border-border bg-popover px-3 py-1.5 shadow-lg pointer-events-none"
        >
          <IconMessage className="w-3.5 h-3.5 text-[#609FF8]" />
          <span className="text-[11px] text-foreground">
            {t("visualEditor.clickToDropCommentPin")}
          </span>
          <span className="text-[10px] text-muted-foreground ml-1">
            {t("visualEditor.escToExit")}
          </span>
        </div>
      )}

      {/* Pin overlays */}
      {pins.map((pin) => {
        const left = rect.left + (pin.xPct / 100) * rect.width;
        const top = rect.top + (pin.yPct / 100) * rect.height;
        const isActive = activePinId === pin.id;
        const PinIcon = pin.submitted ? IconMessageCheck : IconMessage;
        return (
          <div
            key={pin.id}
            data-pin-popover
            data-pin-id={pin.id}
            className="fixed z-[55]"
            style={{ left, top }}
          >
            {/* Pin marker. The tooltip is suppressed while the composer is
             * open: the textarea already shows the same draft text, and a
             * shadcn TooltipContent (z-[250], no `pointer-events: none`) was
             * intercepting Send-button clicks for pins near the top of the
             * canvas where Radix auto-flips the tooltip below the trigger
             * and onto the composer. */}
            <Tooltip open={isActive ? false : undefined}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    if (!pin.submitted) setActivePinId(pin.id);
                  }}
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-full -mt-1 flex items-center justify-center w-7 h-7 rounded-full rounded-bl-none shadow-lg cursor-pointer",
                    pin.submitted
                      ? "bg-emerald-500 text-white"
                      : "bg-[#609FF8] text-black",
                    "hover:scale-110 transition-transform",
                  )}
                >
                  <PinIcon className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="pointer-events-none">
                {pin.draft ||
                  (pin.submitted
                    ? t("visualEditor.commentSent")
                    : t("visualEditor.comment"))}
              </TooltipContent>
            </Tooltip>

            {/* Inline composer. z-[260] keeps it above the shadcn floating-UI
             * tier (z-[250] — Tooltip, Popover, Dialog overlay, etc.) so a
             * stray tooltip that pops over the pin can't swallow Send clicks. */}
            {isActive && !pin.submitted && (
              <div
                data-pin-popover
                className="absolute z-[260] left-3 top-1 w-72 rounded-lg border border-border bg-popover shadow-xl p-2"
              >
                <p className="mb-2 text-xs font-semibold text-foreground">
                  {t("visualEditor.editDesign")}
                </p>
                <Textarea
                  autoFocus
                  value={pin.draft || ""}
                  onChange={(e) => updatePin(pin.id, { draft: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      submitPin(pin);
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      removePin(pin.id);
                    }
                  }}
                  placeholder={t("visualEditor.tellAgentWhatToChange")}
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
                      {t("visualEditor.send")}
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
