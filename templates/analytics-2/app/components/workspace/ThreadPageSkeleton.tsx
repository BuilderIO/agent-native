import { Skeleton } from "@/components/ui/skeleton";

export function ThreadPageSkeleton() {
  return (
    <div
      aria-busy="true"
      className="mx-auto flex min-h-0 w-full max-w-(--agent-kit-conversation-max-width) flex-1 flex-col gap-4 p-4"
    >
      <Skeleton className="ml-auto h-10 w-1/3 rounded-2xl" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="mt-auto h-20 w-full rounded-2xl" />
    </div>
  );
}
