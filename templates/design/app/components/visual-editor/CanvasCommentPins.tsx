import { useEffect, useRef, useState } from "react";
import { IconMessage, IconSend, IconX } from "@tabler/icons-react";
import { agentChat } from "@agent-native/core";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  const [pins, setPins] = useState<CanvasPin[]>([]);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  // Reset pins when the context (slide) changes — they're scoped to one view.
  useEffect(() => {
    setPins([]);
    setActivePinId(null);
  }, [contextId]);

  // Find the canvas container the pins overlay
  useEffect(() => {
    if (!active) return;
    const findCanvas = () => {
      const el = document.querySelector(canvasSelector) as HTMLElement | null;
      if (el) containerRef.current = el;
    };
    findCanvas();
    const t = setTimeout(findCanvas, 50);
    return () => clearTimeout(t);
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
      agentChat.submit(lines.join("\n"));
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
            Click anywhere to drop a comment pin
          </span>
          <span className="text-[10px] text-muted-foreground ml-1">
            Esc to exit
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
            {/* Pin marker */}
            <button
              onClick={() => setActivePinId(pin.id)}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-full -mt-1 flex items-center justify-center w-7 h-7 rounded-full rounded-bl-none shadow-lg cursor-pointer",
                "bg-[#609FF8] text-black hover:scale-110 transition-transform",
              )}
              title={pin.draft || "Comment"}
            >
              <IconMessage className="w-3.5 h-3.5" />
            </button>

            {/* Inline composer */}
            {isActive && !pin.submitted && (
              <div
                data-pin-popover
                className="absolute left-3 top-1 w-72 rounded-lg border border-border bg-popover shadow-xl p-2"
              >
                <p className="mb-2 text-xs font-semibold text-foreground">
                  Edit design
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
                  placeholder="Tell the agent what to change…"
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
