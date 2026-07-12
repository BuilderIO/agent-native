/**
 * <DayHeader /> — Granola-style sticky day section header.
 *
 * Small, semi-uppercase, sticky-on-scroll. Shared across the meetings
 * list and the dictate list.
 */
interface DayHeaderProps {
  label: string;
}

export function DayHeader({ label }: DayHeaderProps) {
  return (
    <div className="sticky top-0 z-10 -mx-1 px-1 backdrop-blur-md bg-background/85 supports-[backdrop-filter]:bg-background/70">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground py-1.5">
        {label}
      </div>
    </div>
  );
}

/**
 * Format a date relative to today: "Today" / "Tomorrow" / "Yesterday" /
 * "Mon · Apr 15" within the same week / "Apr 15" otherwise.
 */
export function formatDayLabel(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    const startOfDay = (x: Date) =>
      new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const ms = 24 * 60 * 60 * 1000;
    const diff = Math.round((startOfDay(d) - startOfDay(today)) / ms);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
    if (diff > 1 && diff <= 6) {
      return d.toLocaleDateString([], {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
    }
    if (diff < -1 && diff >= -6) {
      return d.toLocaleDateString([], {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "Upcoming";
  }
}
