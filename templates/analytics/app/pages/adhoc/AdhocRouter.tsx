import { Suspense, lazy, useEffect } from "react";
import { useParams } from "react-router";

import { incrementItemView } from "@/lib/item-popularity";

import { DashboardSkeleton } from "./DashboardSkeleton";
import { dashboardComponents } from "./registry";

const SqlDashboardPage = lazy(() => import("./sql-dashboard"));

// Single shared loading placeholder used across hydration → exists-check →
// Suspense → dashboard config load. Matches the real SqlChartCard shape (Card
// chrome + title row + chart-body skeleton) so the user sees one continuous
// skeleton state rather than four different ones morphing into each other.
function SqlDashboardLoader() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <SqlDashboardPage />
    </Suspense>
  );
}

export default function AdhocRouter() {
  const { id = "default" } = useParams<{ id: string }>();
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

  return <SqlDashboardLoader />;
}
