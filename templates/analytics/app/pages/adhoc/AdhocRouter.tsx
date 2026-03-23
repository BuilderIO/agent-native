import { Suspense } from "react";
import { useParams } from "react-router";
import { Layout } from "@/components/layout/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { dashboardComponents } from "./registry";
import BlankDashboard from "./BlankDashboard";

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-64 mb-2" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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

export default function AdhocRouter() {
  const { id = "default" } = useParams<{ id: string }>();
  const Component = dashboardComponents[id];

  return (
    <Layout>
      {Component ? (
        <Suspense fallback={<DashboardSkeleton />}>
          <Component />
        </Suspense>
      ) : (
        <BlankDashboard />
      )}
    </Layout>
  );
}
