import { Skeleton } from "@agent-native/toolkit/ui/skeleton";

export function Rows() {
  return (
    <div>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}
