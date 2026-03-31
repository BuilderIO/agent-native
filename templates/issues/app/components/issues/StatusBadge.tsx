import { cn } from "@/lib/utils";
import { getStatusCategoryColor } from "@/lib/issue-utils";
import type { JiraStatus } from "@shared/types";

export function StatusBadge({ status }: { status: JiraStatus }) {
  const colorClass = getStatusCategoryColor(status.statusCategory);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
        colorClass,
      )}
    >
      {status.name}
    </span>
  );
}
