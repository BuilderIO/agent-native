import { cn } from "@/lib/utils";

type PillTone = "muted" | "success" | "warning" | "danger" | "info" | "high";

const TONE_CLASS: Record<PillTone, string> = {
  muted: "bg-muted text-muted-foreground",
  success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-primary/10 text-primary",
  high: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
};

function riskTone(risk?: string | null): PillTone {
  switch (risk?.toLowerCase()) {
    case "low":
      return "success";
    case "medium":
      return "warning";
    case "high":
      return "high";
    case "critical":
      return "danger";
    default:
      return "muted";
  }
}

function statusTone(status?: string | null): PillTone {
  switch (status?.toLowerCase()) {
    case "needs_manual":
      return "warning";
    case "automation_started":
    case "context_fetching":
      return "info";
    case "failed":
    case "reconciliation_required":
      return "danger";
    case "auto_approved":
    case "merged":
    case "resolved":
    case "reviewed":
      return "success";
    default:
      return "muted";
  }
}

function Pill({ value, tone }: { value?: string | null; tone: PillTone }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        TONE_CLASS[tone],
      )}
    >
      {value || "-"}
    </span>
  );
}

export function TriageRiskPill({ risk }: { risk?: string | null }) {
  return <Pill value={risk} tone={riskTone(risk)} />;
}

export function TriageStatusPill({ status }: { status?: string | null }) {
  return <Pill value={status} tone={statusTone(status)} />;
}
