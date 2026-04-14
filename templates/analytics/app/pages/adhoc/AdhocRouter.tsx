import { Suspense, lazy, useEffect } from "react";
import { useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { getIdToken } from "@/lib/auth";
import { dashboardComponents } from "./registry";
import BlankDashboard from "./BlankDashboard";

const SqlDashboardPage = lazy(() => import("./sql-dashboard"));

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-64 mb-2" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[300px] w-full rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-[250px] w-full rounded-xl" />
        <Skeleton className="h-[250px] w-full rounded-xl" />
      </div>
    </div>
  );
}

function SqlDashboardLoader({ id }: { id: string }) {
  const { data: exists, isLoading } = useQuery({
    queryKey: ["sql-dashboard-exists", id],
    queryFn: async () => {
      const token = await getIdToken();
      const res = await fetch(`/api/sql-dashboards/${id}`, {
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
  }, [id]);

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
