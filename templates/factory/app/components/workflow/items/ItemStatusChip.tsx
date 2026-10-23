import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleDot,
  IconCircleOff,
  IconHourglass,
  IconRoute,
  type Icon,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";

import type { ChipTone, ItemPhase, PhaseKey } from "./item-status";

const PHASE_ICONS: Record<PhaseKey, Icon> = {
  needs_you: IconAlertTriangle,
  waiting: IconHourglass,
  failed: IconAlertCircle,
  dismissed: IconCircleOff,
  done: IconCircleCheck,
  active: IconCircleDot,
  in_flow: IconRoute,
  other: IconCircleDot,
};

const TONE_STYLES: Record<ChipTone, string> = {
  attention: "bg-destructive/10 text-destructive",
  waiting: "bg-muted text-foreground",
  neutral: "bg-muted text-muted-foreground",
};

export function ItemStatusChip({
  phase,
  className,
}: {
  phase: ItemPhase;
  className?: string;
}) {
  const PhaseIcon = PHASE_ICONS[phase.key];
  return (
    <span
      className={cn(
        "inline-flex max-w-full shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-4",
        TONE_STYLES[phase.tone],
        className,
      )}
    >
      <PhaseIcon className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{phase.label}</span>
    </span>
  );
}
