import type { ReactNode } from "react";

import { cn } from "../lib/utils";

export const APP_LIST_GRID_CLASS =
  "mx-auto w-full max-w-[1000px] xl:grid xl:grid-cols-2 xl:gap-3 xl:overflow-visible xl:rounded-none xl:bg-transparent";
export const APP_LIST_GRID_ROW_CLASS =
  "xl:rounded-2xl xl:border xl:border-transparent xl:bg-card xl:transition-[background-color,border-color] xl:hover:border-border xl:focus-within:border-ring/50";

export function AppList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-2xl bg-card", className)}>
      {children}
    </div>
  );
}

export function AppListRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group flex min-w-0 items-center gap-3 border-b px-4 py-3.5 last:border-b-0 transition-[background-color,border-color] hover:bg-muted/30 focus-within:bg-muted/30",
        className,
      )}
    >
      {children}
    </div>
  );
}
