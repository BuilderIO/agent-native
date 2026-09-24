import { useSidebarTrigger } from "@/components/layout/sidebar-trigger";
import { Skeleton } from "@/components/ui/skeleton";

export function DocumentEditorSkeleton({ title }: { title?: string | null }) {
  const sidebarTrigger = useSidebarTrigger();
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        {sidebarTrigger}
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <Skeleton className="h-6 w-6 rounded-md" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Skeleton className="h-7 w-20 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-md" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto w-full max-w-3xl px-4 pt-14 pb-16 sm:px-8 md:px-16 md:pt-16">
          <Skeleton className="mb-4 h-12 w-12 rounded-lg" />
          {title ? (
            // Same typography and box as the editor's title textarea so the
            // authoritative title replaces it without any layout shift.
            <div className="block w-full break-words bg-transparent p-0 font-bold leading-tight text-foreground text-3xl md:text-4xl">
              {title}
            </div>
          ) : (
            <Skeleton className="h-11 w-2/3" />
          )}
          <div className="space-y-3 pt-12">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <div className="space-y-3 pt-8">
            <Skeleton className="h-4 w-10/12" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-7/12" />
          </div>
        </div>
      </div>
    </div>
  );
}
