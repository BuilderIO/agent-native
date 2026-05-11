import { Suspense, lazy, useEffect } from "react";
import { useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getIdToken } from "@/lib/auth";
import { dashboardComponents } from "./registry";
import BlankDashboard from "./BlankDashboard";
import { appApiPath } from "@agent-native/core/client";
import { incrementItemView } from "@/lib/item-popularity";

const SqlDashboardPage = lazy(() => import("./sql-dashboard"));

// Single shared loading placeholder used across hydration → exists-check →
// Suspense → dashboard config load. Matches the real SqlChartCard shape (Card
// chrome + title row + chart-body skeleton) so the user sees one continuous
// skeleton state rather than four different ones morphing into each other.
function DashboardSkeleton() {
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

function SqlDashboardLoader({ id }: { id: string }) {
  const { data: exists, isLoading } = useQuery({
    queryKey: ["sql-dashboard-exists", id],
    queryFn: async () => {
      const token = await getIdToken();
      const res = await fetch(appApiPath(`/api/sql-dashboards/${id}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return res.ok;
    },
    staleTime: 30_000,
  });

  if (isLoading) return <DashboardSkeleton />;
  if (!exists) return <BlankDashboard />;

  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <SqlDashboardPage />
    </Suspense>
  );
}

export default function AdhocRouter() {
  const { id = "default" } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const Component = dashboardComponents[id];

  useEffect(() => {
    localStorage.setItem("last-dashboard-id", id);
    if (Component) incrementItemView("dashboard", id);
  }, [Component, id]);

  // Code-based dashboards take priority
  if (Component) {
    return (
      <Suspense fallback={<DashboardSkeleton />}>
        <Component />
      </Suspense>
    );
  }

  // Check for SQL dashboard (id passed via URL param, or use the route id)
  const sqlId = searchParams.get("id") || id;

  return <SqlDashboardLoader id={sqlId} />;
}
