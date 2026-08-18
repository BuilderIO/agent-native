import type { ReactNode } from "react";

import { cn } from "../utils.js";

export interface IntegrationGridItem {
  id: string;
  name: string;
  description?: string;
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
          "rounded-xl bg-muted/30 px-5 py-8 text-center text-xs text-muted-foreground",
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
        "grid gap-2 overflow-hidden rounded-xl bg-muted/20 p-2",
        "sm:grid-cols-2",
        className,
      )}
    >
      {items.map((item) => (
        <article
          key={item.id}
          className="flex min-w-0 items-center gap-3 rounded-lg bg-muted/35 px-3 py-3.5"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background/80 text-foreground">
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
            {item.description ? (
              <p className="mt-0.5 line-clamp-1 text-xs leading-5 text-muted-foreground">
                {item.description}
              </p>
            ) : null}
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
