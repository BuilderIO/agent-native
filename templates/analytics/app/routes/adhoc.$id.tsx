import AdhocRouter from "@/pages/adhoc/AdhocRouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function meta() {
  return [{ title: "Dashboard — Analytics" }];
}

export function HydrateFallback() {
  // Match the dashboard's own !loaded skeleton so hydration doesn't flash a
  // full-page spinner before morphing into the dashboard layout. The user
  // perceives a single, continuous skeleton state through hydration → config
  // load → per-panel query load.
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <Card key={i} className="flex flex-col overflow-visible">
            <CardHeader className="pb-2 shrink-0">
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent className="flex flex-1 flex-col pt-0">
              <Skeleton className="w-full flex-1 min-h-[250px]" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function AdhocRoute() {
  return <AdhocRouter />;
}
