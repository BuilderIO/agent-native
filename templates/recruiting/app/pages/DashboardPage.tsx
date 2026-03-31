import { useNavigate } from "react-router";
import { useDashboard } from "@/hooks/use-greenhouse";
import { formatRelativeDate, cn } from "@/lib/utils";
import {
  IconBriefcase,
  IconUsers,
  IconCalendar,
  IconLoader2,
} from "@tabler/icons-react";

export function DashboardPage() {
  const { data, isLoading, error } = useDashboard();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {error ? "Failed to load dashboard data" : "No data available"}
        </p>
      </div>
    );
  }

  const stats = [
    {
      label: "Open Jobs",
      value: data.openJobs,
      icon: IconBriefcase,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
      onClick: () => navigate("/jobs"),
    },
    {
      label: "Active Candidates",
      value: data.activeCandidates,
      icon: IconUsers,
      color: "text-green-500",
      bg: "bg-green-500/10",
      onClick: () => navigate("/candidates"),
    },
    {
      label: "Upcoming Interviews",
      value: data.upcomingInterviews,
      icon: IconCalendar,
      color: "text-orange-500",
      bg: "bg-orange-500/10",
      onClick: () => navigate("/interviews"),
    },
  ];

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-xl font-semibold text-foreground mb-6">Dashboard</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {stats.map((stat) => (
          <button
            key={stat.label}
            onClick={stat.onClick}
            className="flex items-center gap-4 rounded-lg border border-border p-4 text-left hover:bg-accent/50"
          >
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-lg",
                stat.bg,
              )}
            >
              <stat.icon className={cn("h-5 w-5", stat.color)} />
            </div>
            <div>
              <div className="text-2xl font-semibold text-foreground tabular-nums">
                {stat.value}
              </div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Recent applications */}
      <div>
        <h2 className="text-sm font-medium text-foreground mb-3">
          Recent Applications
        </h2>
        {data.recentApplications.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No recent applications
          </p>
        ) : (
          <div className="rounded-lg border border-border divide-y divide-border">
            {data.recentApplications.map((app) => (
              <div
                key={app.id}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">
                      {app.jobs?.[0]?.name ?? "Unknown Job"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {app.current_stage?.name ?? "No stage"}
                      {app.source && (
                        <span> &middot; via {app.source.public_name}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                      app.status === "active"
                        ? "bg-green-500/10 text-green-600"
                        : app.status === "hired"
                          ? "bg-blue-500/10 text-blue-600"
                          : "bg-red-500/10 text-red-600",
                    )}
                  >
                    {app.status}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatRelativeDate(app.applied_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
