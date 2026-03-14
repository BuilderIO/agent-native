import { cn } from "@/lib/utils";
import {
  Twitter,
  TrendingUp,
  Shield,
  Clock,
  Heart,
} from "lucide-react";
import type { ResearchSignal } from "@shared/api";

const signalConfig: Record<
  ResearchSignal["type"],
  { icon: typeof Twitter; color: string; bg: string; valueBg: string }
> = {
  social: {
    icon: Twitter,
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
    valueBg: "bg-blue-500/20",
  },
  ranking: {
    icon: TrendingUp,
    color: "text-green-400",
    bg: "bg-green-500/10 border-green-500/20",
    valueBg: "bg-green-500/20",
  },
  authority: {
    icon: Shield,
    color: "text-purple-400",
    bg: "bg-purple-500/10 border-purple-500/20",
    valueBg: "bg-purple-500/20",
  },
  recency: {
    icon: Clock,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
    valueBg: "bg-amber-500/20",
  },
  engagement: {
    icon: Heart,
    color: "text-rose-400",
    bg: "bg-rose-500/10 border-rose-500/20",
    valueBg: "bg-rose-500/20",
  },
};

interface SignalBadgeProps {
  signal: ResearchSignal;
}

export function SignalBadge({ signal }: SignalBadgeProps) {
  const config = signalConfig[signal.type];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border",
        config.bg,
        config.color
      )}
    >
      <Icon size={10} className="shrink-0" />
      {signal.value && (
        <span
          className={cn(
            "font-semibold px-1 py-px rounded text-[10px]",
            config.valueBg
          )}
        >
          {signal.value}
        </span>
      )}
      <span className="truncate">{signal.label}</span>
    </span>
  );
}
