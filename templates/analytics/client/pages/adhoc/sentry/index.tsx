import { useState, useMemo } from "react";
import { useSentryIssues, useSentryStats } from "./hooks";
import { ProjectSelector } from "./ProjectSelector";
import { IssuesTable } from "./IssuesTable";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import {
  ErrorTrendChart,
  ErrorsByProjectChart,
  ErrorsByLevelChart,
} from "./StatsCharts";
import type { TimePeriod } from "./types";

const TIME_OPTIONS: { label: string; value: TimePeriod }[] = [
  { label: "1h", value: "1h" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "14d", value: "14d" },
  { label: "30d", value: "30d" },
];

export default function SentryDashboard() {
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [period, setPeriod] = useState<TimePeriod>("24h");
  const [searchQuery, setSearchQuery] = useState("");

  const project =
    selectedProjects.length === 1 ? selectedProjects[0] : undefined;
  const query = searchQuery.trim() || undefined;

  const {
    data: issues,
    isLoading: issuesLoading,
    error: issuesError,
  } = useSentryIssues(project, query, period);

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
  } = useSentryStats(period);

  const filteredIssues = useMemo(() => {
    if (!issues) return undefined;
    if (selectedProjects.length <= 1) return issues;
    return issues.filter((i) => selectedProjects.includes(i.project.slug));
  }, [issues, selectedProjects]);

  const summaryStats = useMemo(() => {
    if (!filteredIssues)
      return { totalEvents: 0, unresolvedCount: 0, usersAffected: 0 };
    let totalEvents = 0;
    let usersAffected = 0;
    let unresolvedCount = 0;
    for (const issue of filteredIssues) {
      totalEvents += parseInt(issue.count);
      usersAffected += issue.userCount;
      if (issue.status === "unresolved") unresolvedCount++;
    }
    return { totalEvents, unresolvedCount, usersAffected };
  }, [filteredIssues]);

  const rateTotal = useMemo(() => {
    if (!stats?.groups) return null;
    let accepted = 0;
    let total = 0;
    for (const g of stats.groups) {
      const qty = g.totals["sum(quantity)"] ?? 0;
      total += qty;
      if (g.by.outcome === "accepted") accepted += qty;
    }
    return { accepted, total };
  }, [stats]);

  return (
    <div className="space-y-6">
      <DashboardHeader description="Error tracking and issue monitoring across Builder.io services" />

      {/* Controls */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-md border border-border overflow-hidden">
            {TIME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  period === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search issues..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 rounded-md border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground w-64 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <ProjectSelector
          selected={selectedProjects}
          onChange={setSelectedProjects}
        />
      </div>

      {/* Error display */}
      {(issuesError || statsError) && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {(issuesError as Error)?.message ||
            (statsError as Error)?.message ||
            "Failed to fetch Sentry data"}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Events"
          value={formatLargeNumber(summaryStats.totalEvents)}
          loading={issuesLoading}
        />
        <StatCard
          label="Unresolved Issues"
          value={String(summaryStats.unresolvedCount)}
          loading={issuesLoading}
          variant={summaryStats.unresolvedCount > 50 ? "danger" : "default"}
        />
        <StatCard
          label="Users Affected"
          value={formatLargeNumber(summaryStats.usersAffected)}
          loading={issuesLoading}
        />
        <StatCard
          label="Accepted Errors"
          value={
            rateTotal
              ? formatLargeNumber(rateTotal.accepted)
              : "-"
          }
          loading={statsLoading}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ErrorTrendChart stats={stats} isLoading={statsLoading} />
        <ErrorsByProjectChart
          issues={filteredIssues}
          isLoading={issuesLoading}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ErrorsByLevelChart issues={filteredIssues} isLoading={issuesLoading} />
      </div>

      {/* Issues table */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-3">
          Top Issues
        </h2>
        <IssuesTable issues={filteredIssues} isLoading={issuesLoading} />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
  variant = "default",
}: {
  label: string;
  value: string;
  loading: boolean;
  variant?: "default" | "danger";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {loading ? (
        <div className="text-lg font-bold text-muted-foreground animate-pulse">
          ...
        </div>
      ) : (
        <div
          className={`text-2xl font-bold ${variant === "danger" ? "text-red-400" : "text-foreground"}`}
        >
          {value}
        </div>
      )}
    </div>
  );
}

function formatLargeNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
