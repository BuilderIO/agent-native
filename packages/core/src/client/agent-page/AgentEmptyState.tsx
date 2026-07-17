import type { ComponentType, ReactNode } from "react";

import { cn } from "../utils.js";

interface AgentEmptyStateProps {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function AgentEmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: AgentEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-3 border-y border-border/60 py-5",
        className,
      )}
    >
      {Icon ? (
        <Icon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mt-1 max-w-2xl break-words text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}
