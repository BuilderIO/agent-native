import { sendToAgentChat, useT } from "@agent-native/core/client";
import {
  IconAlertTriangle,
  IconBolt,
  IconCircleCheck,
  IconMessage,
  IconMessageCheck,
  IconSend,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

interface CanvasCommentPinsProps {
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

type PinCapabilityStatus =
  | "deterministic"
  | "needs-agent"
  | "conflict"
  | "unsupported";

interface PinStatusMeta {
  status: PinCapabilityStatus;
  label: string;
  shortLabel: string;
  detail: string;
  markerClassName: string;
  badgeClassName: string;
}

const STATUS_META: Record<PinCapabilityStatus, PinStatusMeta> = {
  deterministic: {
    status: "deterministic",
    label: "",
    shortLabel: "",
    detail: "",
    markerClassName: "bg-emerald-500 text-white ring-emerald-200",
    badgeClassName:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  "needs-agent": {
    status: "needs-agent",
    label: "",
    shortLabel: "",
    detail: "",
    markerClassName: "bg-amber-400 text-amber-950 ring-amber-200",
    badgeClassName:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  conflict: {
    status: "conflict",
    label: "",
    shortLabel: "",
    detail: "",
    markerClassName:
      "bg-destructive text-destructive-foreground ring-destructive/30",
    badgeClassName: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  unsupported: {
    status: "unsupported",
    label: "",
    shortLabel: "",
    detail: "",
    markerClassName: "bg-muted text-muted-foreground ring-border",
    badgeClassName: "border-border bg-muted text-muted-foreground",
  },
};

function localizePinStatus(
  status: PinStatusMeta,
  t: (key: string, options?: Record<string, unknown>) => string,
): PinStatusMeta {
  return {
    ...status,
    label: t(`visualEditor.pinStatus.${status.status}.label`),
    shortLabel: t(`visualEditor.pinStatus.${status.status}.shortLabel`),
    detail: t(`visualEditor.pinStatus.${status.status}.detail`),
  };
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

function wordsIncludePair(
  text: string,
  first: string,
  second: string,
): boolean {
  return (
    new RegExp(`\\b${first}\\b`, "i").test(text) &&
    new RegExp(`\\b${second}\\b`, "i").test(text)
  );
}

function hasContradictoryLanguage(text: string): boolean {
  return [
    ["bigger", "smaller"],
    ["larger", "smaller"],
    ["hide", "show"],
    ["remove", "keep"],
    ["delete", "keep"],
    ["left", "right"],
    ["top", "bottom"],
    ["dark", "light"],
  ].some(([first, second]) => wordsIncludePair(text, first, second));
}

function pinsLikelyOverlap(pin: CanvasPin, other: CanvasPin): boolean {
  if (pin.id === other.id || other.submitted) return false;
  if (pin.targetSelector && pin.targetSelector === other.targetSelector)
    return true;
  const xDelta = Math.abs(pin.xPct - other.xPct);
  const yDelta = Math.abs(pin.yPct - other.yPct);
  return xDelta <= 4 && yDelta <= 4;
}

function derivePinStatus(pin: CanvasPin, pins: CanvasPin[]): PinStatusMeta {
  const text = (pin.draft || "").toLowerCase();
  const anchored = Boolean(pin.targetSelector || pin.targetAnchorId);
  const unsupported =
    /\b(api|backend|database|server|auth|login|oauth|stripe|payment|email|webhook|permission|role|roles|deploy|domain|routing|route|video|audio|3d|three\.js|pdf|spreadsheet)\b/i.test(
      text,
    );
  if (unsupported) return STATUS_META.unsupported;

  const overlaps = pins.some(
    (other) =>
      pinsLikelyOverlap(pin, other) &&
      (pin.draft || "").trim() &&
      (other.draft || "").trim() &&
      (pin.draft || "").trim() !== (other.draft || "").trim(),
  );
  if (overlaps || hasContradictoryLanguage(text)) {
    return STATUS_META.conflict;
  }

  const directEdit =
    /\b(color|font|copy|text|label|spacing|gap|margin|padding|radius|rounded|border|align|center|move|resize|width|height|background|image|button|headline|section|swap|replace)\b/i.test(
      text,
    );
  const vagueInstruction =
    /\b(polish|improve|better|nice|clean up|fix it|make it work|decide|surprise me)\b/i.test(
      text,
    );

  if (anchored && directEdit && !vagueInstruction) {
    return STATUS_META.deterministic;
  }

  return STATUS_META["needs-agent"];
}

function PinStatusBadge({ status }: { status: PinStatusMeta }) {
  const Icon =
    status.status === "deterministic"
      ? IconCircleCheck
      : status.status === "unsupported" || status.status === "conflict"
        ? IconAlertTriangle
        : IconBolt;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none",
            status.badgeClassName,
          )}
        >
          <Icon className="size-3" />
          {status.label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{status.detail}</TooltipContent>
    </Tooltip>
  );
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
  submitMode = "direct",
  onClose,
  onPinsChange,
  submitQueuedSignal,
  clickPlaneUnderToolbar = false,
  canvasSelector,
  contextId,
  contextLabel,
}: CanvasCommentPinsProps) {
  const t = useT();
  const [pins, setPins] = useState<CanvasPin[]>([]);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const lastSubmitQueuedSignalRef = useRef(submitQueuedSignal);
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
  const statusCounts = useMemo(
    () =>
      pins.reduce<Record<PinCapabilityStatus, number>>(
        (counts, pin) => {
          const status = derivePinStatus(pin, pins).status;
          counts[status] += 1;
          return counts;
        },
        {
          deterministic: 0,
          "needs-agent": 0,
          conflict: 0,
          unsupported: 0,
        },
      ),
    [pins],
  );

  const buildPinLines = (pin: CanvasPin, index?: number) => {
    const status = localizePinStatus(derivePinStatus(pin, pins), t);
    const lines = [
      index === undefined
        ? `[Comment pin on ${contextLabel || contextId}]`
        : `[${index + 1}] Comment pin on ${contextLabel || contextId}`,
      `Position: ${pin.xPct.toFixed(1)}% from left, ${pin.yPct.toFixed(1)}% from top`,
      `Capability: ${status.label} - ${status.detail}`,
    ];
    if (pin.targetAnchorId) lines.push(`Anchor id: ${pin.targetAnchorId}`);
    if (pin.targetSelector) lines.push(`Element: ${pin.targetSelector}`);
    if (pin.targetText) lines.push(`Nearby text: "${pin.targetText}"`);
    lines.push("");
    lines.push((pin.draft || "").trim());
    return lines;
  };

  const sendPinsToAgent = (targetPins: CanvasPin[], batch = false) => {
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
      // Use `sendToAgentChat` (not the shared `agentChat.submit`) so the
      // request routes correctly when design is embedded in Builder/Frame
      // and so the agent sidebar is reliably opened via the `agent-panel:open`
      // custom event even if the user has it collapsed.
      sendToAgentChat({
        message,
        submit: true,
        openSidebar: true,
      });
    } catch (err) {
      console.error("[CanvasCommentPins] failed to send to agent:", err);
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

  const submitPin = (pin: CanvasPin) => {
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
    sendPinsToAgent([nextPin]);
    updatePin(pin.id, { draft: text, queued: false, submitted: true });
    setActivePinId(null);
  };

  const submitQueuedPins = () => {
    if (queuedPins.length === 0) return;
    if (submitMode === "queue") return;
    sendPinsToAgent(queuedPins, true);
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

  if (!active && pins.length === 0) return null;

  // Render pins as portaled overlays positioned on top of the canvas
  const canvas = containerRef.current ?? canvasEl;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const summaryLeft = Math.min(rect.right - 8, window.innerWidth - 8);
  const summaryTop = Math.max(rect.top + 8, 72);

  return (
    <>
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

      {/* Compact queue/result summary for local annotation batching. */}
      {pins.length > 0 && (
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
                disabled={queuedPins.length === 0}
              >
                <IconBolt className="size-3" />
                {t("visualEditor.batchApply")}
              </Button>
            ) : (
              <span className="rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                {t("visualEditor.queued")}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1 text-[10px]">
            <span className="rounded-md bg-muted/45 px-2 py-1 text-muted-foreground">
              {t("visualEditor.pinStatusCount.direct", {
                count: statusCounts.deterministic,
              })}
            </span>
            <span className="rounded-md bg-muted/45 px-2 py-1 text-muted-foreground">
              {t("visualEditor.pinStatusCount.agent", {
                count: statusCounts["needs-agent"],
              })}
            </span>
            <span className="rounded-md bg-muted/45 px-2 py-1 text-muted-foreground">
              {t("visualEditor.pinStatusCount.conflict", {
                count: statusCounts.conflict,
              })}
            </span>
            <span className="rounded-md bg-muted/45 px-2 py-1 text-muted-foreground">
              {t("visualEditor.pinStatusCount.blocked", {
                count: statusCounts.unsupported,
              })}
            </span>
          </div>
        </div>
      )}

      {/* Pin overlays */}
      {pins.map((pin) => {
        const left = rect.left + (pin.xPct / 100) * rect.width;
        const top = rect.top + (pin.yPct / 100) * rect.height;
        const isActive = activePinId === pin.id;
        const PinIcon = pin.submitted ? IconMessageCheck : IconMessage;
        const status = localizePinStatus(derivePinStatus(pin, pins), t);
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
                    status.markerClassName,
                    pin.submitted && "opacity-95",
                  )}
                >
                  <PinIcon className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="pointer-events-none">
                {pin.queued
                  ? t("visualEditor.queuedStatus", { status: status.label })
                  : pin.draft ||
                    (pin.submitted
                      ? t("visualEditor.commentSentStatus", {
                          status: status.label,
                        })
                      : t("visualEditor.commentStatus", {
                          status: status.label,
                        }))}
              </TooltipContent>
            </Tooltip>
            <span
              className={cn(
                "pointer-events-none absolute left-3 -top-10 rounded-full border px-1.5 py-0.5 text-[9px] font-medium leading-none shadow-sm",
                status.badgeClassName,
              )}
            >
              {pin.queued && !pin.submitted
                ? t("visualEditor.queued")
                : status.shortLabel}
            </span>

            {/* Inline composer. z-[260] keeps it above the shadcn floating-UI
             * tier (z-[250] — Tooltip, Popover, Dialog overlay, etc.) so a
             * stray tooltip that pops over the pin can't swallow Send clicks. */}
            {isActive && !pin.submitted && (
              <div
                data-pin-popover
                className="absolute z-[260] left-3 top-1 w-72 rounded-lg border border-border bg-popover shadow-xl p-2"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-foreground">
                    {t("visualEditor.editDesign")}
                  </p>
                  <PinStatusBadge status={status} />
                </div>
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
                      e.preventDefault();
                      removePin(pin.id);
                    }
                  }}
                  placeholder={t("visualEditor.tellAgentWhatToChange")}
                  className="resize-none text-xs min-h-[60px]"
                />
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                  {status.detail}
                </p>
                {pin.targetAnchorId && (
                  <div className="mt-1 truncate rounded-md bg-muted/45 px-2 py-1 text-[10px] text-muted-foreground">
                    {t("visualEditor.anchorLabel", {
                      id: pin.targetAnchorId,
                    })}
                  </div>
                )}
                {pin.targetText && (
                  <div className="text-[10px] text-muted-foreground mt-1 italic line-clamp-1">
                    {t("visualEditor.nearText", { text: pin.targetText })}
                  </div>
                )}
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-muted-foreground">
                    {t("visualEditor.submitShortcut", {
                      mod: /Mac|iPhone|iPad/.test(navigator.userAgent)
                        ? "⌘"
                        : "Ctrl",
                    })}
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
                      variant="outline"
                      className="h-6 gap-1 px-2 text-[10px] cursor-pointer"
                      onClick={() => queuePin(pin)}
                      disabled={!(pin.draft || "").trim()}
                    >
                      {t("visualEditor.queue")}
                    </Button>
                    {submitMode === "direct" && (
                      <Button
                        size="sm"
                        className="h-6 gap-1 px-2 text-[10px] cursor-pointer"
                        onClick={() => submitPin(pin)}
                        disabled={!(pin.draft || "").trim()}
                      >
                        <IconSend className="w-3 h-3" />
                        {t("visualEditor.send")}
                      </Button>
                    )}
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
