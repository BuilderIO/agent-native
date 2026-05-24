import type { ReactNode } from "react";
import {
  IconDotsVertical,
  IconClock,
  IconX,
  IconCheck,
  IconBellOff,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { QueueBadge, QueueCardType } from "@/hooks/use-queue";

interface QueueCardProps {
  /** Lead-in badge row (kept short — 1–3 badges max). */
  badges: QueueBadge[];
  title: ReactNode;
  subtitle?: ReactNode;
  /** Primary CTA, usually "Open" / "Review" — rendered as a default button. */
  primary?: { label: string; onClick?: () => void; href?: string };
  /** Tone for the card edge accent — derived from the highest-severity badge. */
  accent?: QueueBadge["tone"];
  /** Snooze actions surfaced in the dropdown. */
  onSnooze?: (until: "tomorrow" | "next-week") => void;
  onMarkDone?: () => void;
  onDismiss?: () => void;
  onMuteType?: () => void;
  cardType: QueueCardType;
  className?: string;
  children?: ReactNode;
}

const TONE_BADGE_CLASS: Record<QueueBadge["tone"], string> = {
  neutral: "bg-muted text-muted-foreground border-transparent",
  info: "bg-blue-100 text-blue-900 border-transparent dark:bg-blue-950/60 dark:text-blue-200",
  warning:
    "bg-amber-100 text-amber-900 border-transparent dark:bg-amber-950/60 dark:text-amber-200",
  danger:
    "bg-red-100 text-red-900 border-transparent dark:bg-red-950/60 dark:text-red-200",
  success:
    "bg-emerald-100 text-emerald-900 border-transparent dark:bg-emerald-950/60 dark:text-emerald-200",
};

const ACCENT_RING: Record<QueueBadge["tone"], string> = {
  neutral: "ring-border/60",
  info: "ring-blue-300/40 dark:ring-blue-500/30",
  warning: "ring-amber-300/50 dark:ring-amber-500/30",
  danger: "ring-red-300/60 dark:ring-red-500/30",
  success: "ring-emerald-300/60 dark:ring-emerald-500/30",
};

const ACCENT_BAR: Record<QueueBadge["tone"], string> = {
  neutral: "bg-transparent",
  info: "bg-blue-400/60 dark:bg-blue-500/50",
  warning: "bg-amber-400/70 dark:bg-amber-500/60",
  danger: "bg-red-400/80 dark:bg-red-500/60",
  success: "bg-emerald-400/70 dark:bg-emerald-500/60",
};

const CARD_TYPE_LABEL: Record<QueueCardType, string> = {
  "pr-to-review": "PR reviews",
  "my-pr-status-change": "PR status updates",
  "my-pr-ci-failure": "CI failures",
  "run-needs-input": "Agent runs",
  "error-new": "Error reports",
};

/**
 * Shared shell for every Attention Queue card. Renders a tonal accent ring
 * (driven by the loudest badge), a badge row, title, subtitle, slot for
 * card-specific body content, the primary CTA, and an overflow dropdown
 * with snooze / done / dismiss / mute.
 *
 * Each card type composes this shell instead of repeating the chrome.
 */
export function QueueCard({
  badges,
  title,
  subtitle,
  primary,
  accent,
  onSnooze,
  onMarkDone,
  onDismiss,
  onMuteType,
  cardType,
  className,
  children,
}: QueueCardProps) {
  const tone = accent ?? badges[0]?.tone ?? "neutral";
  return (
    <Card
      className={cn(
        "group relative overflow-hidden ring-1 transition-all hover:-translate-y-px hover:border-border hover:shadow-md",
        ACCENT_RING[tone],
        className,
      )}
    >
      {/* Tonal left edge — subtle but readable at a glance */}
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-0.5", ACCENT_BAR[tone])}
      />
      <CardContent className="space-y-3 px-5 py-4 pl-[1.4rem]">
        <div className="flex flex-wrap items-center gap-2">
          {badges.map((b, i) => (
            <Badge
              key={`${b.label}-${i}`}
              variant="outline"
              className={cn("font-medium", TONE_BADGE_CLASS[b.tone])}
            >
              {b.label}
            </Badge>
          ))}
          <div className="ml-auto flex items-center gap-1">
            {primary ? (
              primary.href ? (
                <Button asChild size="sm" className="cursor-pointer">
                  <a
                    href={primary.href}
                    target={
                      primary.href.startsWith("http") ? "_blank" : undefined
                    }
                    rel={
                      primary.href.startsWith("http") ? "noreferrer" : undefined
                    }
                  >
                    {primary.label}
                  </a>
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="cursor-pointer"
                  onClick={primary.onClick}
                >
                  {primary.label}
                </Button>
              )
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 cursor-pointer text-muted-foreground hover:text-foreground"
                  aria-label="More actions"
                >
                  <IconDotsVertical size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Snooze</DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={() => onSnooze?.("tomorrow")}
                  className="cursor-pointer"
                >
                  <IconClock size={16} />
                  Tomorrow
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => onSnooze?.("next-week")}
                  className="cursor-pointer"
                >
                  <IconClock size={16} />
                  Next week
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={onMarkDone}
                  className="cursor-pointer"
                >
                  <IconCheck size={16} />
                  Mark done
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={onDismiss}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <IconX size={16} />
                  Dismiss
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={onMuteType}
                  className="cursor-pointer"
                >
                  <IconBellOff size={16} />
                  Mute {CARD_TYPE_LABEL[cardType]}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold leading-snug text-foreground">
            {title}
          </h3>
          {subtitle ? (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
