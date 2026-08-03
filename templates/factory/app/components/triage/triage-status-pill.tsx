import { cn } from "@/lib/utils";

type TriageStatusPillProps = {
  status?: string | null;
};

export function TriageStatusPill({ status }: TriageStatusPillProps) {
  const normalizedStatus = status?.toLowerCase();
  const tone =
    normalizedStatus === "high" || normalizedStatus === "critical"
      ? "bg-destructive/10 text-destructive"
      : normalizedStatus === "reviewed" || normalizedStatus === "resolved"
        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
        : normalizedStatus === "medium" || normalizedStatus === "pending"
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : "bg-muted text-muted-foreground";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone,
      )}
    >
      {status || "-"}
    </span>
  );
}
