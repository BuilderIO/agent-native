import { Badge } from "@agent-native/toolkit/ui/badge";
import { IconDots, IconPlus } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { cn } from "../utils.js";

export interface IntegrationGridItem {
  id: string;
  name: string;
  description?: string;
  logo: ReactNode;
  status?: string;
  statusClassName?: string;
  badge?: string;
  actionLabel: string;
  actionAriaLabel?: string;
  actionKind?: "connect" | "manage";
  disabled?: boolean;
  onAction?: () => void;
  action?: ReactNode;
  fullWidth?: boolean;
}

export interface IntegrationGridProps {
  items: IntegrationGridItem[];
  emptyLabel?: string;
  className?: string;
  variant?: "cards" | "rows";
}

export function IntegrationGrid({
  items,
  emptyLabel = "No integrations found.",
  className,
  variant = "cards",
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

  if (variant === "rows") {
    return (
      <div
        className={cn(
          "grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2",
          className,
        )}
      >
        {items.map((item) => {
          const actionKind = item.actionKind ?? "connect";
          const ActionIcon = actionKind === "manage" ? IconDots : IconPlus;
          const actionWord = actionKind === "manage" ? "Manage" : "Connect";
          const hasAction =
            item.action !== undefined || typeof item.onAction === "function";
          return (
            <article
              key={item.id}
              className={cn(
                "flex min-w-0 items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent/40",
                item.fullWidth && "md:col-span-2",
              )}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md text-foreground">
                {item.logo}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <h3 className="min-w-0 truncate text-sm font-medium text-foreground">
                    {item.name}
                  </h3>
                  {item.badge ? (
                    <Badge
                      variant="default"
                      className="h-4 shrink-0 rounded-sm border-primary/80 px-1 py-0 text-[9px] font-semibold uppercase tracking-[0.4px] shadow-sm"
                    >
                      {item.badge}
                    </Badge>
                  ) : null}
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
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {item.description}
                  </p>
                ) : null}
              </div>
              {hasAction
                ? (item.action ?? (
                    <button
                      type="button"
                      onClick={item.onAction}
                      disabled={item.disabled}
                      title={item.actionLabel}
                      aria-label={
                        item.actionAriaLabel ?? `${actionWord} ${item.name}`
                      }
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ActionIcon className="size-4" />
                    </button>
                  ))
                : null}
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <div className="agent-native-integration-grid min-w-0">
      <div
        className={cn(
          "agent-native-integration-grid__items grid grid-cols-1 gap-2 overflow-hidden rounded-xl bg-muted/20 p-2",
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
                <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
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
    </div>
  );
}
