import type { ReactNode } from "react";

import { cn } from "../utils.js";

export interface IntegrationGridItem {
  id: string;
  name: string;
  description: string;
  logo: ReactNode;
  status?: string;
  statusClassName?: string;
  actionLabel: string;
  actionAriaLabel?: string;
  disabled?: boolean;
  onAction: () => void;
}

export interface IntegrationGridProps {
  items: IntegrationGridItem[];
  emptyLabel?: string;
  className?: string;
}

/**
 * The shared integration list surface. Keep provider rows intentionally
 * boring: identity, one-line context, and one clear next action.
 */
export function IntegrationGrid({
  items,
  emptyLabel = "No integrations found.",
  className,
}: IntegrationGridProps) {
  if (items.length === 0) {
    return (
      <div
        className={cn(
          "rounded-xl border border-dashed border-border px-5 py-8 text-center text-xs text-muted-foreground",
          className,
        )}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid gap-x-8 overflow-hidden rounded-xl border border-border/70 bg-card px-4",
        "sm:grid-cols-2",
        className,
      )}
    >
      {items.map((item) => (
        <article
          key={item.id}
          className="flex min-w-0 items-center gap-3 border-b border-border/60 py-3.5 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-foreground">
            {item.logo}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-sm font-medium text-foreground">
                {item.name}
              </h3>
              {item.status ? (
                <span
                  className={cn(
                    "shrink-0 text-[11px] font-medium text-muted-foreground",
                    item.statusClassName,
                  )}
                >
                  {item.status}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 line-clamp-1 text-xs leading-5 text-muted-foreground">
              {item.description}
            </p>
          </div>
          <button
            type="button"
            onClick={item.onAction}
            disabled={item.disabled}
            aria-label={
              item.actionAriaLabel ?? `${item.actionLabel} ${item.name}`
            }
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {item.actionLabel}
          </button>
        </article>
      ))}
    </div>
  );
}
