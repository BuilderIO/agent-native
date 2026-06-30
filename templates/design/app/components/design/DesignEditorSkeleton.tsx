import { Skeleton } from "@/components/ui/skeleton";

const panelGhost = "bg-[var(--design-editor-skeleton-panel-ghost-bg)]";
const panelGhostStrong =
  "bg-[var(--design-editor-skeleton-panel-ghost-strong-bg)]";
const frameGhost = "bg-[var(--design-editor-skeleton-frame-ghost-bg)]";
const frameGhostStrong =
  "bg-[var(--design-editor-skeleton-frame-ghost-strong-bg)]";
const dockGhost = "bg-[var(--design-editor-skeleton-dock-ghost-bg)]";

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
        <aside className="hidden w-80 shrink-0 border-r border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)] lg:flex">
          <div className="flex w-[52px] shrink-0 flex-col items-center border-r border-[var(--design-editor-panel-divider-color)] py-3">
            <Skeleton className={`mb-3 size-8 rounded-md ${panelGhost}`} />
            <Skeleton className={`mb-5 h-px w-8 rounded-none ${panelGhost}`} />
            <div className="flex flex-1 flex-col items-center gap-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton
                  key={index}
                  className={`h-10 w-12 rounded-md ${
                    index === 0 ? panelGhostStrong : panelGhost
                  }`}
                />
              ))}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center border-b border-[var(--design-editor-panel-divider-color)] px-3">
              <Skeleton
                className={`h-4 min-w-0 flex-1 rounded ${panelGhost}`}
              />
            </div>
            <div className="shrink-0 border-b border-[var(--design-editor-panel-divider-color)] p-2">
              <div className="mb-2 flex items-center justify-between">
                <Skeleton className={`h-3 w-16 rounded ${panelGhost}`} />
                <div className="flex gap-1">
                  <Skeleton className={`size-6 rounded-sm ${panelGhost}`} />
                  <Skeleton className={`size-6 rounded-sm ${panelGhost}`} />
                </div>
              </div>
              <Skeleton
                className={`h-7 w-full rounded-sm ${panelGhostStrong}`}
              />
              <Skeleton className={`mt-1 h-7 w-4/5 rounded-sm ${panelGhost}`} />
            </div>
            <div className="shrink-0 border-b border-[var(--design-editor-panel-divider-color)] p-2">
              <Skeleton className={`h-7 w-full rounded-sm ${panelGhost}`} />
            </div>
            <div className="flex-1 space-y-1.5 p-2">
              <Skeleton className={`h-6 w-full rounded-sm ${panelGhost}`} />
              <Skeleton className={`h-6 w-11/12 rounded-sm ${panelGhost}`} />
              <Skeleton className={`h-6 w-4/5 rounded-sm ${panelGhost}`} />
              <Skeleton className={`h-6 w-2/3 rounded-sm ${panelGhost}`} />
            </div>
          </div>
        </aside>
      )}

      <main className="relative min-w-0 flex-1 overflow-hidden bg-[var(--design-editor-skeleton-canvas-bg)]">
        <div className="flex h-full items-center justify-center px-10 pb-28 pt-10">
          <div
            aria-hidden="true"
            className="w-full max-w-[620px] overflow-hidden rounded-xl border border-[var(--design-editor-skeleton-frame-border)] bg-[var(--design-editor-skeleton-frame-bg)] shadow-[0_28px_80px_-44px_rgba(0,0,0,0.85)]"
          >
            <div className="flex h-10 items-center justify-between border-b border-[var(--design-editor-skeleton-frame-border)] bg-[var(--design-editor-skeleton-frame-header-bg)] px-4">
              <div className="flex items-center gap-2">
                <Skeleton
                  className={`size-2.5 rounded-full ${frameGhostStrong}`}
                />
                <Skeleton className={`size-2.5 rounded-full ${frameGhost}`} />
                <Skeleton className={`size-2.5 rounded-full ${frameGhost}`} />
              </div>
              <Skeleton className={`h-3 w-32 rounded ${frameGhost}`} />
            </div>
            <div className="space-y-5 p-7">
              <div className="flex items-center justify-between gap-8">
                <div className="min-w-0 flex-1 space-y-3">
                  <Skeleton className={`h-7 w-4/5 rounded-md ${frameGhost}`} />
                  <Skeleton className={`h-7 w-3/5 rounded-md ${frameGhost}`} />
                </div>
                <Skeleton className={`h-11 w-28 rounded-full ${frameGhost}`} />
              </div>
              <div className="rounded-xl border border-[var(--design-editor-skeleton-frame-border)] bg-[var(--design-editor-skeleton-frame-section-bg)] p-4">
                <Skeleton className={`mb-4 h-40 rounded-lg ${frameGhost}`} />
                <div className="grid grid-cols-3 gap-3">
                  <Skeleton className={`h-16 rounded-lg ${frameGhost}`} />
                  <Skeleton className={`h-16 rounded-lg ${frameGhost}`} />
                  <Skeleton className={`h-16 rounded-lg ${frameGhost}`} />
                </div>
              </div>
              <div className="grid grid-cols-[0.65fr_1fr] gap-4">
                <Skeleton className={`h-24 rounded-xl ${frameGhost}`} />
                <Skeleton className={`h-24 rounded-xl ${frameGhost}`} />
              </div>
            </div>
          </div>
        </div>

        {!embedded && (
          <div className="absolute bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-[var(--design-editor-skeleton-dock-border)] bg-[var(--design-editor-skeleton-dock-bg)] p-2 shadow-[0_22px_55px_-24px_rgba(0,0,0,0.9)]">
            <div className="flex gap-1">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton
                  key={index}
                  className={`h-9 w-9 rounded-md ${dockGhost}`}
                />
              ))}
            </div>
            <Skeleton className="h-12 w-px rounded-none bg-[var(--design-editor-skeleton-dock-divider-bg)]" />
            <div className="flex gap-1 rounded-lg bg-[var(--design-editor-skeleton-panel-ghost-bg)] p-1">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton
                  key={index}
                  className={`size-8 rounded-md ${dockGhost}`}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      {!embedded && (
        <aside className="hidden w-80 shrink-0 flex-col border-l border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)] lg:flex">
          <div className="shrink-0 border-b border-[var(--design-editor-panel-divider-color)] p-2">
            <div className="flex flex-wrap justify-end gap-1">
              <Skeleton className={`h-7 w-12 rounded-md ${panelGhost}`} />
              <Skeleton className={`h-7 w-14 rounded-md ${panelGhost}`} />
              <Skeleton className={`h-7 w-16 rounded-md ${panelGhost}`} />
              <Skeleton className={`size-7 rounded-md ${panelGhost}`} />
            </div>
          </div>
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--design-editor-panel-divider-color)] px-3">
            <div className="flex gap-1">
              <Skeleton className={`h-7 w-16 rounded-md ${panelGhostStrong}`} />
              <Skeleton className={`h-7 w-16 rounded-md ${panelGhost}`} />
            </div>
            <Skeleton className={`h-7 w-12 rounded-md ${panelGhost}`} />
          </div>
          <div className="space-y-3 p-3">
            <Skeleton className={`h-4 w-24 rounded ${panelGhost}`} />
            <Skeleton className={`h-7 w-full rounded-md ${panelGhost}`} />
            <Skeleton className={`h-7 w-full rounded-md ${panelGhost}`} />
            <Skeleton className={`h-4 w-20 rounded ${panelGhost}`} />
            <Skeleton className={`h-32 w-full rounded-md ${panelGhost}`} />
          </div>
        </aside>
      )}
    </div>
  );
}
