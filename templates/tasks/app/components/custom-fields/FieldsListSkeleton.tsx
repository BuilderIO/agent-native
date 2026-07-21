import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROW_COUNT = 3;

export function FieldsListSkeleton() {
  return (
    <div
      aria-label="Fields list"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 outline-none"
    >
      <div className="grid gap-2">
        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
          <Skeleton key={index} className="h-14 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
