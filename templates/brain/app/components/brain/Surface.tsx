import { Badge } from "@agent-native/toolkit/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@agent-native/toolkit/ui/card";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleDashed,
  IconClock,
  IconInfoCircle,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-border bg-card px-4 py-5 sm:px-5 lg:flex-row lg:items-center lg:justify-between lg:px-7">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-normal text-foreground break-words">
          {title}
        </h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {actions ? (
        <div className="w-full min-w-0 shrink-0 sm:w-auto">{actions}</div>
      ) : null}
    </header>
  );
}

export function EmptyActionState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-border bg-card p-5 text-sm">
      <div className="flex gap-3">
        <IconInfoCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="font-medium text-foreground">{title}</p>
          <p className="mt-1 leading-6 text-muted-foreground">{detail}</p>
        </div>
      </div>
    </div>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid gap-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="rounded-md border border-border bg-card p-4"
        >
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="mt-3 h-3 w-4/5" />
          <Skeleton className="mt-2 h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: "neutral" | "good" | "warning" | "danger";
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between gap-3">
          <div className="text-2xl font-semibold tracking-normal">{value}</div>
          <span
            className={cn(
              "mb-1 h-2 w-2 rounded-full",
              tone === "good" && "bg-primary",
              tone === "warning" && "bg-amber-500",
              tone === "danger" && "bg-destructive",
              tone === "neutral" && "bg-muted-foreground",
            )}
          />
        </div>
        {detail ? (
          <p className="mt-2 truncate text-xs text-muted-foreground">
            {detail}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const Icon =
    normalized.includes("approved") || normalized.includes("healthy")
      ? IconCircleCheck
      : normalized.includes("review") ||
          normalized.includes("degraded") ||
          normalized.includes("stale")
        ? IconClock
        : normalized.includes("error")
          ? IconAlertTriangle
          : IconCircleDashed;

  return (
    <Badge
      variant="outline"
      className={cn(
        "max-w-full gap-1.5 capitalize",
        (normalized.includes("approved") || normalized.includes("healthy")) &&
          "border-border bg-secondary text-secondary-foreground",
        (normalized.includes("review") ||
          normalized.includes("degraded") ||
          normalized.includes("stale")) &&
          "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        normalized.includes("error") &&
          "border-destructive/35 bg-destructive/10 text-destructive",
      )}
    >
      <Icon className="size-3" />
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "capitalize",
        priority === "high" &&
          "bg-destructive/10 text-destructive hover:bg-destructive/15",
        priority === "medium" &&
          "bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300",
        priority === "low" &&
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      )}
    >
      {priority}
    </Badge>
  );
}
