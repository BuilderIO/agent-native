import { DocumentEditorSkeleton } from "@/components/editor/DocumentEditorSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

export function ContentLoadingShell() {
  return (
    <div
      aria-busy="true"
      className="flex h-dvh overflow-hidden bg-background text-foreground"
    >
      <div
        aria-hidden="true"
        className="hidden w-60 shrink-0 flex-col gap-6 border-e border-border bg-sidebar p-3 min-[1100px]:flex"
      >
        <Skeleton className="h-8 w-full rounded-md" />
        <div className="space-y-3">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-6 w-3/4" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-5/6" />
          <Skeleton className="h-6 w-3/4" />
        </div>
      </div>
      <div aria-hidden="true" className="flex min-w-0 flex-1">
        <DocumentEditorSkeleton />
      </div>
    </div>
  );
}
