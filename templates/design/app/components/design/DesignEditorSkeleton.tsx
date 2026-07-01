import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

const panelGhost = "bg-[var(--design-editor-skeleton-panel-ghost-bg)]";

/**
 * Loading placeholder for the design editor. Keeps the shell recognizable while
 * staying quiet enough that it does not read as mock content.
 */
export function DesignEditorSkeleton({
  embedded = false,
  pendingGeneration = false,
}: {
  embedded?: boolean;
  pendingGeneration?: boolean;
}) {
  if (pendingGeneration) {
    return (
      <div className="flex h-full overflow-hidden bg-[var(--design-editor-canvas-bg)]">
        {!embedded && (
          <aside className="relative flex min-h-0 shrink-0 border-r border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)]">
            <div className="flex w-[52px] shrink-0 flex-col items-center p-3">
              <Skeleton className={`size-8 rounded-md ${panelGhost}`} />
              <div className="mt-8 flex w-full flex-col items-center gap-3">
                <Skeleton className={`size-8 rounded-lg ${panelGhost}`} />
                <Skeleton className={`size-8 rounded-lg ${panelGhost}`} />
                <Skeleton className={`size-8 rounded-lg ${panelGhost}`} />
              </div>
            </div>
            <div className="flex w-[320px] min-w-0 flex-col bg-[var(--design-editor-panel-bg)]">
              <div className="border-b border-[var(--design-editor-panel-divider-color)] p-3">
                <Skeleton className={`h-5 w-28 rounded ${panelGhost}`} />
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-4 p-3">
                <Skeleton className={`h-16 w-full rounded-lg ${panelGhost}`} />
                <Skeleton className={`h-24 w-5/6 rounded-lg ${panelGhost}`} />
                <div className="mt-auto space-y-2">
                  <Skeleton className={`h-9 w-full rounded-lg ${panelGhost}`} />
                  <Skeleton className={`h-9 w-3/4 rounded-lg ${panelGhost}`} />
                </div>
              </div>
            </div>
          </aside>
        )}

        <main className="relative min-w-0 flex-1 overflow-hidden bg-[var(--design-editor-skeleton-canvas-bg)]">
          <div className="flex h-full min-h-0 items-center justify-center px-8 py-10">
            <div className="flex w-full max-w-md flex-col items-center text-center">
              <div className="mb-4 flex size-12 items-center justify-center rounded-xl border border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)] shadow-[0_18px_50px_-34px_rgba(0,0,0,0.8)]">
                <Spinner className="size-5 text-foreground/40" />
              </div>
              <Skeleton className={`h-4 w-32 rounded ${panelGhost}`} />
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {!embedded && (
        <aside className="hidden w-80 shrink-0 bg-[var(--design-editor-panel-bg)] lg:flex">
          <div className="flex w-[52px] shrink-0 flex-col items-center p-3">
            <Skeleton className={`size-8 rounded-md ${panelGhost}`} />
            <Skeleton className={`mt-8 h-40 w-full rounded-lg ${panelGhost}`} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
            <Skeleton className={`h-4 w-full rounded ${panelGhost}`} />
            <Skeleton className={`h-24 w-full rounded-lg ${panelGhost}`} />
            <Skeleton className={`h-36 w-4/5 rounded-lg ${panelGhost}`} />
          </div>
        </aside>
      )}

      <main className="relative min-w-0 flex-1 overflow-hidden bg-[var(--design-editor-skeleton-canvas-bg)]">
        <div className="flex h-full items-center justify-center px-10 pb-28 pt-10">
          <Skeleton
            aria-hidden="true"
            className={`h-72 w-full max-w-[520px] rounded-xl ${panelGhost}`}
          />
        </div>

        {!embedded && (
          <div
            className={`absolute bottom-4 left-1/2 z-[70] h-11 w-64 -translate-x-1/2 rounded-xl ${panelGhost}`}
          />
        )}
      </main>

      {!embedded && (
        <aside className="hidden w-80 shrink-0 flex-col bg-[var(--design-editor-panel-bg)] lg:flex">
          <div className="flex h-12 shrink-0 items-center justify-end px-3">
            <Skeleton className={`h-6 w-40 rounded-md ${panelGhost}`} />
          </div>
          <div className="space-y-4 p-3">
            <Skeleton className={`h-6 w-24 rounded ${panelGhost}`} />
            <Skeleton className={`h-36 w-full rounded-lg ${panelGhost}`} />
          </div>
        </aside>
      )}
    </div>
  );
}
