import { Skeleton } from "@/components/ui/skeleton";

export function DeckEditorSkeleton({ label }: { label: string }) {
  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background"
      role="status"
      aria-label={label}
      data-testid="deck-editor-loading"
    >
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-3">
        <Skeleton className="size-8 rounded-md" />
        <Skeleton className="h-5 w-36" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="size-8 rounded-md" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-56 shrink-0 flex-col gap-4 border-r border-border p-4 sm:w-64 md:flex">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex gap-3">
              <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
              <Skeleton className="aspect-video flex-1 rounded-md" />
            </div>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-center bg-muted/20 p-6">
          <Skeleton className="aspect-video w-full max-w-4xl rounded-md shadow-sm" />
        </div>
      </div>
    </div>
  );
}
