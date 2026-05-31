import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Loading placeholder for the design editor. Mirrors the real editor chrome
 * (toolbar + dot-grid canvas with a faux design frame) so the load reads as
 * "a design is coming" instead of a bare spinner on a black void.
 */
export function DesignEditorSkeleton({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <header
        className={cn(
          "shrink-0 border-b border-border",
          embedded ? "h-10" : "h-12",
        )}
      >
        <div className="flex h-full items-center gap-2 px-3">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-5 w-40 rounded" />
          <Skeleton className="h-4 w-16 rounded-full" />
          <div className="ml-auto flex items-center gap-1.5">
            {!embedded && <Skeleton className="h-7 w-44 rounded-md" />}
            <Skeleton className="h-7 w-7 rounded-md" />
            {!embedded && (
              <>
                <Skeleton className="h-7 w-16 rounded-md" />
                <Skeleton className="h-7 w-14 rounded-md" />
                <Skeleton className="h-7 w-16 rounded-md" />
              </>
            )}
          </div>
        </div>
      </header>

      {/* Canvas */}
      <div className="relative flex-1 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative flex h-full items-center justify-center p-8">
          <div className="w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
            {/* Faux browser bar */}
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Skeleton className="h-2.5 w-2.5 rounded-full" />
              <Skeleton className="h-2.5 w-2.5 rounded-full" />
              <Skeleton className="h-2.5 w-2.5 rounded-full" />
              <Skeleton className="ml-3 h-4 w-48 rounded" />
            </div>
            {/* Faux content */}
            <div className="space-y-6 p-8">
              <div className="space-y-3">
                <Skeleton className="h-8 w-2/3 rounded-lg" />
                <Skeleton className="h-4 w-1/2 rounded" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-28 rounded-xl" />
                <Skeleton className="h-28 rounded-xl" />
                <Skeleton className="h-28 rounded-xl" />
              </div>
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
