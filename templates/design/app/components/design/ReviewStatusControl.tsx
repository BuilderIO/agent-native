import {
  ReviewStatusBadge,
  useSetReviewStatus,
  useT,
} from "@agent-native/core/client";
import type { ReviewStatus } from "@agent-native/core/review";
import { IconChevronDown } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const REVIEW_STATUSES: ReviewStatus[] = [
  "draft",
  "in_review",
  "approved",
  "changes_requested",
];

export interface ReviewStatusControlProps {
  designId: string;
  status?: ReviewStatus | null;
  /** Explicit caller-derived capability. Pass true only for the owner. */
  editable?: boolean;
}

export function ReviewStatusControl({
  designId,
  status,
  editable = false,
}: ReviewStatusControlProps) {
  const t = useT();
  const setStatus = useSetReviewStatus();
  const currentStatus = status ?? "draft";
  const label = (value: ReviewStatus) => t(`review.status.${value}`);
  const compactBadgeClassName =
    "max-w-[8.5rem] truncate px-1.5 py-0 text-[11px] leading-5";

  if (!editable) {
    return (
      <ReviewStatusBadge
        status={currentStatus}
        className={compactBadgeClassName}
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 min-w-0 max-w-full gap-0.5 rounded-full px-0.5 text-xs hover:bg-accent"
          disabled={setStatus.isPending}
          aria-label={t("review.status.change")}
        >
          <ReviewStatusBadge
            status={currentStatus}
            className={compactBadgeClassName}
          />
          <IconChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {REVIEW_STATUSES.map((nextStatus) => (
          <DropdownMenuItem
            key={nextStatus}
            disabled={setStatus.isPending}
            onSelect={() => {
              if (nextStatus === currentStatus || setStatus.isPending) return;
              setStatus.mutate(
                {
                  resourceType: "design",
                  resourceId: designId,
                  status: nextStatus,
                },
                {
                  onError: () => toast.error(t("review.status.saveFailed")),
                },
              );
            }}
          >
            {label(nextStatus)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
