import type { ReactNode } from "react";

import { cn } from "../lib/utils";

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
        "group flex min-w-0 items-center gap-3 border-b px-4 py-3.5 last:border-b-0 transition-[background-color] hover:bg-muted/30 focus-within:bg-muted/30",
        className,
      )}
    >
      {children}
    </div>
  );
}
