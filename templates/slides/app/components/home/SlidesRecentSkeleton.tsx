import { Skeleton } from "@/components/ui/skeleton";

export function SlidesRecentSkeleton() {
  return (
    <div className="agent-template-library-grid" aria-busy="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className="agent-template-library-card group relative min-w-0"
          aria-hidden="true"
        >
          <div className="agent-template-library-primary overflow-hidden rounded-xl border border-border bg-card">
            <div className="agent-template-library-preview bg-muted/30">
              <Skeleton className="size-full rounded-none" />
            </div>
            <div className="agent-template-library-caption">
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
