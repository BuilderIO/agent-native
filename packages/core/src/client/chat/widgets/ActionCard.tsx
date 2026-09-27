import type { ReactNode } from "react";

import { cn } from "../../utils.js";

export function ActionCard({
  icon,
  title,
  detail,
  status,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  status: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-action-card
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-sm",
        className,
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 truncate text-sm font-medium" title={title}>
            {title}
          </p>
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {status}
          </span>
        </div>
        {detail ? (
          <p className="truncate text-xs text-muted-foreground" title={detail}>
            {detail}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
