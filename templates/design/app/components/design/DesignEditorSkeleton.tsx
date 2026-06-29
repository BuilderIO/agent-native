import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholder for the design editor. Mirrors the real editor chrome
 * (side rails + canvas with a faux design frame) so the load reads as
 * "a design is coming" instead of a bare spinner on a black void.
 */
export function DesignEditorSkeleton({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  return (
    <div className="flex h-full overflow-hidden bg-background">
      {!embedded && (
        <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-[var(--design-editor-panel-bg)] lg:flex">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2">
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="h-5 min-w-0 flex-1 rounded" />
          </div>
          <div className="shrink-0 border-b border-border p-2">
            <div className="mb-2 flex items-center justify-between">
              <Skeleton className="h-3 w-16 rounded" />
              <div className="flex gap-1">
                <Skeleton className="size-6 rounded-sm" />
                <Skeleton className="size-6 rounded-sm" />
              </div>
            </div>
            <Skeleton className="h-7 w-full rounded-sm" />
          </div>
          <div className="shrink-0 border-b border-border p-2">
            <Skeleton className="h-7 w-full rounded-sm" />
          </div>
          <div className="flex-1 space-y-1 p-2">
            <Skeleton className="h-6 w-full rounded-sm" />
            <Skeleton className="h-6 w-11/12 rounded-sm" />
            <Skeleton className="h-6 w-4/5 rounded-sm" />
            <Skeleton className="h-6 w-2/3 rounded-sm" />
          </div>
        </aside>
      )}

      <main className="relative min-w-0 flex-1 overflow-hidden bg-[var(--design-editor-canvas-bg)]">
        <div className="flex h-full items-center justify-center p-8">
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

        {!embedded && (
          <div className="absolute bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-white/10 bg-[#2c2c2c]/95 p-2 shadow-[0_22px_55px_-24px_rgba(0,0,0,0.9)]">
            <div className="flex gap-1">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-11 w-16 rounded-md" />
              ))}
            </div>
            <Skeleton className="h-12 w-px rounded-none bg-white/15" />
            <div className="flex gap-1 rounded-lg bg-white/10 p-1">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="size-10 rounded-md" />
              ))}
            </div>
          </div>
        )}
      </main>

      {!embedded && (
        <aside className="hidden w-64 shrink-0 flex-col border-l border-border bg-[var(--design-editor-panel-bg)] lg:flex">
          <div className="shrink-0 border-b border-border p-2">
            <div className="flex flex-wrap justify-end gap-1">
              <Skeleton className="h-7 w-12 rounded-md" />
              <Skeleton className="h-7 w-14 rounded-md" />
              <Skeleton className="h-7 w-16 rounded-md" />
              <Skeleton className="size-7 rounded-md" />
            </div>
          </div>
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
            <div className="flex gap-1">
              <Skeleton className="h-7 w-16 rounded-md" />
              <Skeleton className="h-7 w-16 rounded-md" />
            </div>
            <Skeleton className="h-7 w-12 rounded-md" />
          </div>
          <div className="space-y-3 p-3">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-7 w-full rounded-md" />
            <Skeleton className="h-7 w-full rounded-md" />
            <Skeleton className="h-4 w-20 rounded" />
            <Skeleton className="h-24 w-full rounded-md" />
          </div>
        </aside>
      )}
    </div>
  );
}
