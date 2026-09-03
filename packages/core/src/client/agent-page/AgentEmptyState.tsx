import type { ComponentType, ReactNode } from "react";

import { cn } from "../utils.js";

interface AgentEmptyStateProps {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  variant?: "inline" | "card";
}

export function AgentEmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  variant = "inline",
}: AgentEmptyStateProps) {
  return (
    <div
      className={cn(
        variant === "card"
          ? "flex min-w-0 flex-col items-center gap-2 rounded-xl border border-border/70 bg-card px-5 py-8 text-center"
          : "flex min-w-0 items-start gap-3 border-y border-border/60 py-5",
        className,
      )}
    >
      {Icon ? (
        <Icon
          aria-hidden="true"
          className={cn(
            "shrink-0 text-muted-foreground",
            variant === "card"
              ? "mb-1 size-8 rounded-full bg-muted p-2"
              : "mt-0.5 size-4",
          )}
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p
            className={cn(
              "mt-1 break-words text-sm leading-relaxed text-muted-foreground",
              variant === "card" && "mx-auto max-w-md",
            )}
          >
            {description}
          </p>
        ) : null}
        {action ? (
          <div className={cn(variant === "card" ? "mt-4" : "mt-3")}>
            {action}
          </div>
        ) : null}
      </div>
    </div>
  );
}
