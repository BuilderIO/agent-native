import {
  IconAlertTriangle,
  IconCheck,
  IconLoader2,
  IconMessageQuestion,
  IconWifiOff,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import {
  type CanvasAgentState,
  type CanvasAgentStateInputs,
  deriveCanvasAgentState,
} from "../../pages/design-editor/canvas-agent-state";

export interface CanvasAgentStateBadgeProps {
  inputs: CanvasAgentStateInputs;
  /** Optional override for the transient "done" window (ms). */
  doneWindowMs?: number;
}

interface BadgeStyle {
  icon: ComponentType<{ className?: string }>;
  label: string;
  spin: boolean;
  className: string;
}

const BADGE_STYLES: Record<Exclude<CanvasAgentState, "ready">, BadgeStyle> = {
  working: {
    icon: IconLoader2,
    label: "Working…",
    spin: true,
    className:
      "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  },
  applying: {
    icon: IconLoader2,
    label: "Applying…",
    spin: true,
    className:
      "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  },
  "needs-answer": {
    icon: IconMessageQuestion,
    label: "Needs answer",
    spin: false,
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  },
  warning: {
    icon: IconWifiOff,
    label: "Offline",
    spin: false,
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  },
  done: {
    icon: IconCheck,
    label: "Done",
    spin: false,
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  },
  failed: {
    icon: IconAlertTriangle,
    label: "Failed",
    spin: false,
    className: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300",
  },
};

const DEFAULT_DONE_WINDOW_MS = 4000;

export function CanvasAgentStateBadge({
  inputs,
  doneWindowMs = DEFAULT_DONE_WINDOW_MS,
}: CanvasAgentStateBadgeProps) {
  // Bumped by the decay timer so a transient "done" re-derives to "ready".
  const [, setTick] = useState(0);
  const state = deriveCanvasAgentState(inputs, Date.now(), doneWindowMs);

  useEffect(() => {
    if (state !== "done" || inputs.lastRunCompletedAt == null) return;
    const remaining = inputs.lastRunCompletedAt + doneWindowMs - Date.now();
    const timer = setTimeout(
      () => setTick((value) => value + 1),
      Math.max(0, remaining),
    );
    return () => clearTimeout(timer);
  }, [state, inputs.lastRunCompletedAt, doneWindowMs]);

  if (state === "ready") return null;

  const style = BADGE_STYLES[state];
  const Icon = style.icon;

  return (
    <div
      role="status"
      aria-label={style.label}
      className={cn(
        "pointer-events-none absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm backdrop-blur-sm",
        style.className,
      )}
    >
      <Icon className={cn("size-3.5", style.spin && "animate-spin")} />
      <span>{style.label}</span>
    </div>
  );
}
