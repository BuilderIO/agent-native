import { useEffect } from "react";
import { useNavigate } from "react-router";
import { Layout } from "@/components/layout/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { dashboards } from "@/pages/adhoc/registry";

export default function Index() {
  const navigate = useNavigate();

  useEffect(() => {
    const lastId = localStorage.getItem("last-dashboard-id");
    if (lastId) {
      navigate(`/adhoc/${lastId}`, { replace: true });
    } else if (dashboards.length > 0) {
      navigate(`/adhoc/${dashboards[0].id}`, { replace: true });
    } else {
      navigate("/data-sources", { replace: true });
    }
  }, [navigate]);

  return (
    <Layout>
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[300px] w-full rounded-xl" />
      </div>
    </Layout>
  );
}
