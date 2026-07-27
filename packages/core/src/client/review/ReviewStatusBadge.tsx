import type { ReviewStatus } from "../../review/types.js";
import { cn } from "../utils.js";

export interface ReviewStatusBadgeProps {
  status: ReviewStatus | null | undefined;
  className?: string;
}

const STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  changes_requested: "Changes requested",
};

const STATUS_CLASSES: Record<ReviewStatus, string> = {
  draft: "border-muted bg-muted text-muted-foreground",
  in_review: "border-blue-200 bg-blue-50 text-blue-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  changes_requested: "border-amber-200 bg-amber-50 text-amber-800",
};

export function ReviewStatusBadge({
  status,
  className,
}: ReviewStatusBadgeProps) {
  const normalized = status ?? "draft";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        STATUS_CLASSES[normalized],
        className,
      )}
    >
      {STATUS_LABELS[normalized]}
    </span>
  );
}
