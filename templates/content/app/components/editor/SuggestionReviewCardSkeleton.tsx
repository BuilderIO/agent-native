import { Skeleton } from "@/components/ui/skeleton";

/** The review card's boxes while its page and suggestions load. */
export function SuggestionReviewCardSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 gap-3">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-8 w-40" />
    </div>
  );
}
