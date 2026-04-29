import { useNavigate } from "react-router";
import { useDashboard } from "@/hooks/use-greenhouse";
import {
  formatRelativeDate,
  cn,
  getInitials,
  getAvatarColor,
  titleCase,
} from "@/lib/utils";
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
      <div className="flex h-full flex-col items-center justify-center">
        <p className="text-sm text-muted-foreground mb-3">
          {error ? "Failed to load dashboard data" : "No data available"}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="text-xs text-green-600 hover:underline"
        >
          Try again
        </button>
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
      label: "New This Week",
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
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4 mb-8">
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
            {data.recentApplications.map((app) => {
              const name = titleCase(app.candidate_name ?? "Unknown");
              const initials = getInitials(name);
              const color = getAvatarColor(name);
              return (
                <div
                  key={app.id}
                  onClick={() => navigate(`/candidates/${app.candidate_id}`)}
                  className="flex items-center justify-between gap-3 px-3 py-3 text-sm cursor-pointer hover:bg-accent/50 sm:px-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={cn(
                        "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white",
                        color,
                      )}
                    >
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">
                        {name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {app.jobs?.[0]?.name ?? "Unknown Job"}
                        {" · "}
                        {app.current_stage?.name ?? "No stage"}
                        {app.source?.public_name && (
                          <span className="hidden sm:inline">
                            {" "}
                            · via {app.source.public_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 sm:gap-3">
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
                    <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
                      {formatRelativeDate(app.applied_at)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
