import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ToolsGridProps {
  children: ReactNode;
  className?: string;
}

/**
 * Responsive grid layout for the Custom Tools list page.
 *
 * One column on mobile, two on sm, three on md/lg, four on xl. Used for
 * both the loaded tool cards and the skeleton placeholders.
 */
export function ToolsGrid({ children, className }: ToolsGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Single skeleton placeholder card matching the visual rhythm of `ToolCard`. */
export function ToolCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-5" aria-busy>
      <div className="mb-4 h-10 w-10 animate-pulse rounded-lg bg-muted" />
      <div className="mb-2 h-4 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-3 w-4/5 animate-pulse rounded bg-muted/70" />
      <div className="mt-4 flex items-center gap-2">
        <div className="size-5 animate-pulse rounded-full bg-muted/70" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-muted/60" />
      </div>
    </div>
  );
}
