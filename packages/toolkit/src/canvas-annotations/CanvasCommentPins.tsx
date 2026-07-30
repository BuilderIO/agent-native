import {
  IconBolt,
  IconLoader2,
  IconMessage,
  IconMessageCheck,
  IconSend,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "../ui/button.js";
import { Textarea } from "../ui/textarea.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip.js";
import { cn } from "../utils.js";
import type {
  CanvasAnnotationTranslate,
  SendCanvasAnnotation,
} from "./types.js";

export interface CanvasPin {
  id: string;
  /** Position as a percentage of the canvas (so it survives resize/zoom) */
  xPct: number;
  yPct: number;
  /** Optional CSS selector of the element under the click, for context */
  targetSelector?: string;
  /** Best-effort stable canvas/code-layer id when the clicked layer exposes one. */
  targetAnchorId?: string;
  /** Optional snippet of text content the user clicked near */
  targetText?: string;
  /** Pending comment text the user is composing */
  draft?: string;
  /** Held locally until the user batch-applies queued comments. */
  queued?: boolean;
  /** Submitted state — the marker stays visible as confirmation. */
  submitted?: boolean;
}

export interface CanvasCommentPinsProps {
  translate: CanvasAnnotationTranslate;
  sendToAgent: SendCanvasAnnotation;
  onSendError?: () => void;
  allowQueue?: boolean;
  showAnchorDetails?: boolean;
  showSubmitShortcut?: boolean;
  /** Whether the pin tool is active. When true, clicks drop pins. */
  active: boolean;
  /** In queue mode, pin Send adds to the shared annotation batch. */
  submitMode?: "direct" | "queue";
  /** Disable / exit the pin mode (called on Escape, after submit, etc.) */
  onClose: () => void;
  /** Mirrors local pins to a parent that can submit them with other annotations. */
  onPinsChange?: (pins: CanvasPin[]) => void;
  /** Increment to mark queued pins as submitted by a parent action. */
  submitQueuedSignal?: number;
  /** Keep the click plane below a sibling draw toolbar in combined annotate mode. */
  clickPlaneUnderToolbar?: boolean;
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

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeCssIdentifier(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

/**
 * Best-effort check for whether a pin's captured anchor element still exists
 * on the canvas. Only meaningful for parent-DOM canvases with a captured
 * `targetSelector` — iframe canvases never capture one (see `dropPinAt`), so
 * this naturally no-ops there rather than mislabeling every iframe pin as
 * stale. Recomputed on each render (already triggered by scroll/resize/pins
 * changes); this deliberately avoids adding a dedicated poll so idle canvas
 * perf is unaffected.
 */
function pinAnchorStillPresent(canvas: HTMLElement, pin: CanvasPin): boolean {
  if (!pin.targetSelector) return true;
  try {
    return canvas.querySelector(pin.targetSelector) !== null;
  } catch {
    // A selector that no longer parses shouldn't be reported as "stale" —
    // that's a different failure mode than "the element was removed".
    return true;
  }
}

function getTargetAnchor(target?: HTMLElement | null): {
  targetSelector?: string;
  targetAnchorId?: string;
} {
  const anchor = target?.closest(
    "[data-agent-native-node-id], [data-builder-id], [data-loc], [id]",
  );
  if (!(anchor instanceof HTMLElement)) return {};

  for (const attribute of [
    "data-agent-native-node-id",
    "data-builder-id",
    "data-loc",
  ]) {
    const value = anchor.getAttribute(attribute);
    if (value) {
      return {
        targetSelector: `[${attribute}="${escapeAttributeValue(value)}"]`,
        targetAnchorId: value,
      };
    }
  }

  if (anchor.id) {
    return {
      targetSelector: `#${escapeCssIdentifier(anchor.id)}`,
      targetAnchorId: anchor.id,
    };
  }

  return {};
}

function getTargetBehindClickPlane(
  clickPlane: HTMLElement,
  canvas: HTMLElement,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const pointerEvents = clickPlane.style.pointerEvents;
  clickPlane.style.pointerEvents = "none";
  try {
    const targets = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [document.elementFromPoint(clientX, clientY)];
    for (const target of targets) {
      if (!(target instanceof HTMLElement) || !canvas.contains(target)) {
        continue;
      }
      return target instanceof HTMLIFrameElement ? null : target;
    }
    return null;
  } finally {
    clickPlane.style.pointerEvents = pointerEvents;
  }
}

/**
 * Purely visual "same spot" check used to spread overlapping markers apart on
 * screen. This also considers submitted pins so a new pin dropped on top of an
 * earlier confirmation marker doesn't render fully hidden underneath it.
 */
function pinsAtSameSpot(pin: CanvasPin, other: CanvasPin): boolean {
  if (pin.id === other.id) return false;
  const xDelta = Math.abs(pin.xPct - other.xPct);
  const yDelta = Math.abs(pin.yPct - other.yPct);
  return xDelta <= 3 && yDelta <= 3;
}

/**
 * Deterministic pixel nudge for a pin whose marker would otherwise render
 * stacked exactly on top of an earlier pin at (approximately) the same
 * canvas position. Pins are placed in a small golden-angle spiral around
 * their true position so every marker in a cluster stays visible and
 * individually clickable; the stored `xPct`/`yPct` (and the position sent to
 * the agent) are unaffected.
 */
function pinClusterOffset(
  pin: CanvasPin,
  indexInPins: number,
  pins: CanvasPin[],
): { dx: number; dy: number } {
  let clusterIndex = 0;
  for (let i = 0; i < indexInPins; i++) {
    if (pinsAtSameSpot(pin, pins[i]!)) clusterIndex += 1;
  }
  if (clusterIndex === 0) return { dx: 0, dy: 0 };
  const angle = clusterIndex * 2.4; // golden angle (radians) for even spread
  const radius = 9 + clusterIndex * 5;
  return {
    dx: Math.round(Math.cos(angle) * radius),
    dy: Math.round(Math.sin(angle) * radius),
  };
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
  translate,
  sendToAgent,
  onSendError,
  allowQueue = true,
  showAnchorDetails = true,
  showSubmitShortcut = true,
  active,
  submitMode = "direct",
  onClose,
  onPinsChange,
  submitQueuedSignal,
  clickPlaneUnderToolbar = false,
  canvasSelector,
  contextId,
  contextLabel,
}: CanvasCommentPinsProps) {
  const t = translate;
  const [pins, setPins] = useState<CanvasPin[]>([]);
  // Mirrors `pins` so the context-change reset effect below can inspect what
  // was on the canvas the instant `contextId` changes, without re-running on
  // every pin edit (it should only fire once, on the context switch itself).
  const pinsRef = useRef<CanvasPin[]>(pins);
  pinsRef.current = pins;
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);
  const lastSubmitQueuedSignalRef = useRef(submitQueuedSignal);
  const [canvasEl, setCanvasEl] = useState<HTMLElement | null>(null);
  // Dummy tick forces a re-render (and a fresh getBoundingClientRect()) whenever
  // the canvas scrolls or resizes, keeping pin overlays in sync.
  const [, setLayoutTick] = useState(0);

  // Reset pins when the context (slide) changes — they're scoped to one view.
  useEffect(() => {
    // Queued-but-unsent comment drafts don't survive a context switch (pins
    // are intentionally scoped to one view). Losing them is unavoidable here
    // since we don't control cross-view navigation, but it must never be
    // silent — warn instead of quietly wiping the user's typed drafts.
    const discardedDraftCount = pinsRef.current.filter(
      (pin) => pin.queued && !pin.submitted && (pin.draft || "").trim(),
    ).length;
    if (discardedDraftCount > 0) {
      toast(
        t("visualEditor.queuedCommentsDiscarded", {
          count: discardedDraftCount,
        }),
      );
    }
    setPins([]);
    setActivePinId(null);
    setCanvasEl(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on an
    // actual context (slide/design) switch, not on every pins/t change.
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

  // Re-render when the canvas element moves in the viewport (scroll or resize),
  // so getBoundingClientRect() returns fresh coordinates for pin overlays.
  useEffect(() => {
    const canvas = containerRef.current ?? canvasEl;
    if (!canvas) return;

    const bump = () => setLayoutTick((t) => t + 1);

    // ResizeObserver fires when the canvas element's own size changes.
    const ro = new ResizeObserver(bump);
    ro.observe(canvas);

    // Scroll listeners on every scrollable ancestor and the window cover both
    // page-level scrolling and container-level panning. Walk the ancestor
    // chain with getComputedStyle instead of a class-name heuristic so
    // inline-styled, nested, and multiple scroll containers are all covered.
    const isScrollable = (value: string) =>
      value === "auto" || value === "scroll" || value === "overlay";
    const scrollTargets: Array<HTMLElement | Window> = [];
    for (let el: HTMLElement | null = canvas; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (
        isScrollable(style.overflow) ||
        isScrollable(style.overflowX) ||
        isScrollable(style.overflowY)
      ) {
        scrollTargets.push(el);
      }
    }
    scrollTargets.push(window);
    for (const target of scrollTargets) {
      target.addEventListener("scroll", bump, { passive: true });
    }
    window.addEventListener("resize", bump, { passive: true });

    return () => {
      ro.disconnect();
      for (const target of scrollTargets) {
        target.removeEventListener("scroll", bump);
      }
      window.removeEventListener("resize", bump);
    };
  }, [canvasEl]);

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
      const { targetSelector, targetAnchorId } = getTargetAnchor(target);
      const targetText = target?.textContent?.trim().slice(0, 80) || undefined;

      const newPin: CanvasPin = {
        id: crypto.randomUUID(),
        xPct,
        yPct,
        targetSelector,
        targetAnchorId,
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

  const queuedPins = useMemo(
    () =>
      pins.filter(
        (pin) => pin.queued && !pin.submitted && (pin.draft || "").trim(),
      ),
    [pins],
  );

  useEffect(() => {
    onPinsChange?.(pins);
  }, [onPinsChange, pins]);

  useEffect(() => {
    if (
      submitQueuedSignal === undefined ||
      submitQueuedSignal === lastSubmitQueuedSignalRef.current
    ) {
      return;
    }
    lastSubmitQueuedSignalRef.current = submitQueuedSignal;
    if (queuedPins.length === 0) return;
    const submittedIds = new Set(queuedPins.map((pin) => pin.id));
    setPins((prev) =>
      prev.map((pin) =>
        submittedIds.has(pin.id)
          ? { ...pin, queued: false, submitted: true }
          : pin,
      ),
    );
    setActivePinId(null);
  }, [queuedPins, submitQueuedSignal]);

  const submittedCount = pins.filter((pin) => pin.submitted).length;

  const buildPinLines = (pin: CanvasPin, index?: number) => {
    const lines = [
      index === undefined
        ? `[Comment pin on ${contextLabel || contextId}]`
        : `[${index + 1}] Comment pin on ${contextLabel || contextId}`,
      `Position: ${pin.xPct.toFixed(1)}% from left, ${pin.yPct.toFixed(1)}% from top`,
    ];
    if (pin.targetAnchorId) lines.push(`Anchor id: ${pin.targetAnchorId}`);
    if (pin.targetSelector) lines.push(`Element: ${pin.targetSelector}`);
    if (pin.targetText) lines.push(`Nearby text: "${pin.targetText}"`);
    lines.push("");
    lines.push((pin.draft || "").trim());
    return lines;
  };

  const sendPinsToAgent = async (
    targetPins: CanvasPin[],
    batch = false,
  ): Promise<boolean> => {
    const message = batch
      ? [
          `[Comment batch on ${contextLabel || contextId}]`,
          `Annotations: ${targetPins.length}`,
          "",
          ...targetPins.flatMap((pin, index) => [
            ...buildPinLines(pin, index),
            "",
          ]),
        ].join("\n")
      : buildPinLines(targetPins[0]!).join("\n");

    try {
      return await sendToAgent({
        message,
        submit: true,
        openSidebar: true,
      });
    } catch (err) {
      console.error("[CanvasCommentPins] failed to send to agent:", err);
      return false;
    }
  };

  const queuePin = (pin: CanvasPin) => {
    const text = (pin.draft || "").trim();
    if (!text) {
      removePin(pin.id);
      return;
    }
    updatePin(pin.id, { draft: text, queued: true });
    setActivePinId(null);
  };

  const submitPin = async (pin: CanvasPin) => {
    const text = (pin.draft || "").trim();
    if (!text) {
      removePin(pin.id);
      return;
    }
    if (submitMode === "queue") {
      queuePin(pin);
      return;
    }
    const nextPin = { ...pin, draft: text };
    setSending(true);
    const delivered = await sendPinsToAgent([nextPin]);
    setSending(false);
    if (delivered) {
      updatePin(pin.id, { draft: text, queued: false, submitted: true });
      setActivePinId(null);
    } else {
      onSendError?.();
    }
  };

  const submitQueuedPins = async () => {
    if (queuedPins.length === 0) return;
    if (submitMode === "queue") return;
    setSending(true);
    const delivered = await sendPinsToAgent(queuedPins, true);
    setSending(false);
    if (!delivered) {
      onSendError?.();
      return;
    }
    const submittedIds = new Set(queuedPins.map((pin) => pin.id));
    setPins((prev) =>
      prev.map((pin) =>
        submittedIds.has(pin.id)
          ? { ...pin, queued: false, submitted: true }
          : pin,
      ),
    );
    setActivePinId(null);
  };

  // Refs for drag-detection on the click overlay (Bug 3 fix).
  // A pin is only dropped on a completed click, not on any drag gesture.
  const overlayDownPos = useRef<{ x: number; y: number } | null>(null);
  const overlayDidDrag = useRef(false);

  if (!active && pins.length === 0) return null;

  // Render pins as portaled overlays positioned on top of the canvas
  const canvas = containerRef.current ?? canvasEl;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  // Clamp summaryLeft so the w-64 (256px) panel, which is shifted left by
  // -translate-x-full, never overflows the left viewport edge.
  // 264 = 256 (panel width) + 8 (minimum margin from the viewport left edge).
  const summaryLeft = Math.max(
    264,
    Math.min(rect.right - 8, window.innerWidth - 8),
  );
  const summaryTop = Math.max(rect.top + 8, 72);

  return (
    <TooltipProvider>
      {/* Parent-side click plane. This is what makes iframe canvases commentable:
          clicks inside an iframe never bubble to the parent document. */}
      {active && (
        <div
          data-pin-click-overlay
          className={cn(
            "fixed cursor-crosshair",
            clickPlaneUnderToolbar ? "z-[20]" : "z-[54]",
          )}
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
          onPointerDown={(e) => {
            overlayDownPos.current = { x: e.clientX, y: e.clientY };
            overlayDidDrag.current = false;
            e.stopPropagation();
          }}
          onPointerMove={(e) => {
            if (overlayDownPos.current) {
              const dx = e.clientX - overlayDownPos.current.x;
              const dy = e.clientY - overlayDownPos.current.y;
              if (dx * dx + dy * dy > 16) overlayDidDrag.current = true;
            }
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!overlayDidDrag.current) {
              dropPinAt(
                e.clientX,
                e.clientY,
                getTargetBehindClickPlane(
                  e.currentTarget,
                  canvas,
                  e.clientX,
                  e.clientY,
                ),
              );
            }
            overlayDownPos.current = null;
            overlayDidDrag.current = false;
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
          <span className="!text-[11px] text-foreground">
            {t("visualEditor.clickToDropCommentPin")}
          </span>
          <span className="text-[10px] text-muted-foreground ml-1">
            {t("visualEditor.escToExit")}
          </span>
        </div>
      )}

      {/* Compact queue/result summary for local annotation batching. */}
      {allowQueue && pins.length > 0 && (
        <div
          data-pin-popover
          className="fixed z-[56] w-64 -translate-x-full rounded-lg border border-border bg-popover p-3 shadow-xl"
          style={{ left: summaryLeft, top: summaryTop }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-foreground">
                {t("visualEditor.annotationQueue")}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {t("visualEditor.annotationQueueCounts", {
                  queued: queuedPins.length,
                  sent: submittedCount,
                })}
              </p>
            </div>
            {submitMode === "direct" ? (
              <Button
                size="sm"
                className="h-7 gap-1 px-2 text-[10px]"
                onClick={submitQueuedPins}
                disabled={queuedPins.length === 0 || sending}
              >
                {sending ? (
                  <IconLoader2 className="size-3 animate-spin" />
                ) : (
                  <IconBolt className="size-3" />
                )}
                {t("visualEditor.batchApply")}
              </Button>
            ) : (
              <span className="rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                {t("visualEditor.queued")}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Pin overlays */}
      {pins.map((pin, pinIndex) => {
        const { dx, dy } = pinClusterOffset(pin, pinIndex, pins);
        const left = rect.left + (pin.xPct / 100) * rect.width + dx;
        const top = rect.top + (pin.yPct / 100) * rect.height + dy;
        const isActive = activePinId === pin.id;
        const PinIcon = pin.submitted ? IconMessageCheck : IconMessage;
        // Not submitted yet + claims a specific anchor that's no longer on
        // the canvas (e.g. the element was deleted or the design was edited
        // elsewhere) — flag it instead of silently pretending the position
        // is still meaningful.
        const isStaleAnchor =
          !pin.submitted && !pinAnchorStillPresent(canvas, pin);
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
                    "absolute -mt-1 flex size-7 -translate-x-1/2 -translate-y-full cursor-pointer items-center justify-center rounded-full rounded-bl-none shadow-lg ring-2 transition-transform hover:scale-110",
                    pin.submitted
                      ? "bg-emerald-500 text-white ring-emerald-200"
                      : "bg-[#609FF8] text-white ring-blue-200",
                    pin.submitted && "opacity-95",
                    isStaleAnchor &&
                      "outline outline-2 outline-dashed outline-offset-2 outline-muted-foreground/70",
                  )}
                >
                  <PinIcon className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="pointer-events-none">
                {isStaleAnchor
                  ? t("visualEditor.staleAnchorDetail")
                  : pin.queued
                    ? t("visualEditor.queued")
                    : pin.draft ||
                      (pin.submitted
                        ? t("visualEditor.commentSent")
                        : t("visualEditor.comment"))}
              </TooltipContent>
            </Tooltip>

            {/* Inline composer. z-[260] keeps it above the shadcn floating-UI
             * tier (z-[250] — Tooltip, Popover, Dialog overlay, etc.) so a
             * stray tooltip that pops over the pin can't swallow Send clicks.
             * Composer is flipped horizontally and/or vertically when the pin
             * is near a viewport edge so it stays fully on-screen. */}
            {isActive &&
              !pin.submitted &&
              (() => {
                const composerW = 288; // w-72
                const composerH = 220; // estimated height
                const flipX = left + 12 + composerW > window.innerWidth;
                const flipY = top + 4 + composerH > window.innerHeight;
                return (
                  <div
                    data-pin-popover
                    className="absolute z-[260] w-72 rounded-lg border border-border bg-popover shadow-xl p-2"
                    style={{
                      ...(flipX
                        ? { right: "calc(100% + 4px)", left: "auto" }
                        : { left: "0.75rem" }),
                      ...(flipY
                        ? { bottom: "calc(100% + 4px)", top: "auto" }
                        : { top: "0.25rem" }),
                    }}
                  >
                    <p className="mb-2 text-xs font-semibold text-foreground">
                      {t("visualEditor.editDesign")}
                    </p>
                    <Textarea
                      autoFocus
                      value={pin.draft || ""}
                      onChange={(e) =>
                        updatePin(pin.id, {
                          draft: e.target.value,
                          queued: false,
                        })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          submitPin(pin);
                        }
                        if (e.key === "Escape") {
                          // Stop propagation so the window Escape listener (which
                          // calls onClose) does not also fire. Collapse the composer
                          // back to the pin dot while preserving the draft text —
                          // the pin and any typed draft survive. A second Escape
                          // with no composer open exits pin mode, matching Figma.
                          e.stopPropagation();
                          e.preventDefault();
                          setActivePinId(null);
                        }
                      }}
                      placeholder={t("visualEditor.tellAgentWhatToChange")}
                      className="resize-none text-xs min-h-[60px]"
                    />
                    {showAnchorDetails && pin.targetAnchorId && (
                      <div
                        className={cn(
                          "mt-1 truncate rounded-md px-2 py-1 text-[10px]",
                          isStaleAnchor
                            ? "bg-destructive/10 text-destructive"
                            : "bg-muted/45 text-muted-foreground",
                        )}
                      >
                        {isStaleAnchor
                          ? t("visualEditor.staleAnchorDetail")
                          : t("visualEditor.anchorLabel", {
                              id: pin.targetAnchorId,
                            })}
                      </div>
                    )}
                    {showAnchorDetails && pin.targetText && (
                      <div className="text-[10px] text-muted-foreground mt-1 italic line-clamp-1">
                        {t("visualEditor.nearText", { text: pin.targetText })}
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      {showSubmitShortcut ? (
                        <span className="text-[10px] text-muted-foreground">
                          {t("visualEditor.submitShortcut", {
                            mod: /Mac|iPhone|iPad/.test(navigator.userAgent)
                              ? "⌘"
                              : "Ctrl",
                          })}
                        </span>
                      ) : (
                        <span />
                      )}
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[10px] cursor-pointer"
                          onClick={() => removePin(pin.id)}
                        >
                          <IconX className="w-3 h-3" />
                        </Button>
                        {allowQueue ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 gap-1 px-2 text-[10px] cursor-pointer"
                            onClick={() => queuePin(pin)}
                            disabled={!(pin.draft || "").trim()}
                          >
                            {t("visualEditor.queue")}
                          </Button>
                        ) : null}
                        {submitMode === "direct" && (
                          <Button
                            size="sm"
                            className="h-6 gap-1 px-2 text-[10px] cursor-pointer"
                            onClick={() => submitPin(pin)}
                            disabled={!(pin.draft || "").trim() || sending}
                          >
                            {sending ? (
                              <IconLoader2 className="size-3 animate-spin" />
                            ) : (
                              <IconSend className="size-3" />
                            )}
                            {t("visualEditor.send")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
          </div>
        );
      })}
    </TooltipProvider>
  );
}
