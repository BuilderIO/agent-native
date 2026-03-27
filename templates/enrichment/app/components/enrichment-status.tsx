import type { EnrichmentJob } from "@shared/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const STATUS_CONFIG = {
  pending: {
    label: "Pending",
    className: "bg-yellow-500/15 text-yellow-700 border-yellow-500/25",
  },
  running: {
    label: "Running",
    className: "bg-blue-500/15 text-blue-700 border-blue-500/25",
  },
  completed: {
    label: "Completed",
    className: "bg-green-500/15 text-green-700 border-green-500/25",
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/15 text-red-700 border-red-500/25",
  },
} as const;

interface EnrichmentStatusProps {
  job: EnrichmentJob;
}

export function EnrichmentStatus({ job }: EnrichmentStatusProps) {
  const { label, className } = STATUS_CONFIG[job.status];
  const { found, total } = job.progress;
  const pct = total > 0 ? Math.round((found / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Badge variant="outline" className={cn("text-xs", className)}>
          {label}
        </Badge>

        {total > 0 && (
          <span className="text-xs text-muted-foreground">
            {found}/{total} ({pct}%)
          </span>
        )}
      </div>

      {(job.status === "running" || job.status === "completed") &&
        total > 0 && <Progress value={pct} className="h-2" />}

      {job.status === "failed" && job.error && (
        <p className="text-xs text-destructive">{job.error}</p>
      )}
    </div>
  );
}
