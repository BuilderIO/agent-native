import {
  IconCheck,
  IconLoader2,
  IconPlayerPause,
  IconPlayerStop,
  IconAlertTriangle,
  type Icon,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export type RunDisplayStatus =
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

interface RunStatusPillProps {
  status: RunDisplayStatus;
  /** Optional className. */
  className?: string;
  /** Reduce padding/font for inline / dense use. */
  compact?: boolean;
}

interface PillConfig {
  label: string;
  icon: Icon;
  /** Tailwind classes for the pill background + text. */
  classes: string;
  /** Whether the icon should spin (running). */
  animate?: boolean;
}

const CONFIG: Record<RunDisplayStatus, PillConfig> = {
  running: {
    label: "Running",
    icon: IconLoader2,
    classes:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    animate: true,
  },
  paused: {
    label: "Paused",
    icon: IconPlayerPause,
    classes:
      "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  },
  completed: {
    label: "Completed",
    icon: IconCheck,
    classes:
      "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/25",
  },
  failed: {
    label: "Failed",
    icon: IconAlertTriangle,
    classes: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  },
  stopped: {
    label: "Stopped",
    icon: IconPlayerStop,
    classes: "bg-muted text-muted-foreground border-border",
  },
};

/**
 * Pill rendering the colored status indicator for an agent run.
 *
 * Used by the run list cards and the run detail header. The "running" pill
 * spins its icon so the user can see live runs without parsing colors.
 */
export function RunStatusPill({
  status,
  className,
  compact = false,
}: RunStatusPillProps) {
  const config = CONFIG[status];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        config.classes,
        className,
      )}
      aria-label={`Status: ${config.label}`}
    >
      <Icon
        size={compact ? 12 : 14}
        className={cn(config.animate && "animate-spin")}
        aria-hidden
      />
      {config.label}
    </span>
  );
}
