import { useState, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useJiraProjects, useJiraAnalytics } from "./hooks";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { JiraOverviewCards } from "./JiraOverviewCards";
import { JiraStatusChart } from "./JiraStatusChart";
import { JiraCreatedResolvedChart } from "./JiraCreatedResolvedChart";
import { JiraSearchPanel } from "./JiraSearchPanel";
import { JiraSprintView } from "./JiraSprintView";

const PERIOD_OPTIONS = [
  { label: "7d", value: 7 },
  { label: "14d", value: 14 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
];

export default function JiraDashboard() {
  const [days, setDays] = useState(30);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);

  const { data: projects, isLoading: projectsLoading } = useJiraProjects();
  const {
    data: analytics,
    isLoading: analyticsLoading,
    error: analyticsError,
  } = useJiraAnalytics(selectedProjects, days);

  const projectOptions = useMemo(
    () => projects?.map((p) => ({ key: p.key, name: p.name })) ?? [],
    [projects],
  );

  return (
    <div className="space-y-6">
      <DashboardHeader description="Ticket analytics, search, and sprint tracking" />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border border-border overflow-hidden">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                days === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <ProjectFilter
          options={projectOptions}
          selected={selectedProjects}
          onChange={setSelectedProjects}
          loading={projectsLoading}
        />
      </div>

      {analyticsError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {(analyticsError as Error).message}
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="sprints">Sprints</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          <JiraOverviewCards
            analytics={analytics}
            isLoading={analyticsLoading}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <JiraStatusChart
              analytics={analytics}
              isLoading={analyticsLoading}
            />
            <JiraCreatedResolvedChart
              analytics={analytics}
              isLoading={analyticsLoading}
            />
          </div>
          {analytics && analytics.byAssignee.length > 0 && (
            <AssigneeTable assignees={analytics.byAssignee} />
          )}
        </TabsContent>

        <TabsContent value="search" className="mt-4">
          <JiraSearchPanel defaultProject={selectedProjects[0]} />
        </TabsContent>

        <TabsContent value="sprints" className="mt-4">
          <JiraSprintView />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProjectFilter({
  options,
  selected,
  onChange,
  loading,
}: {
  options: { key: string; name: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <span className="text-xs text-muted-foreground animate-pulse">
        Loading projects...
      </span>
    );
  }

  if (options.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        onClick={() => onChange([])}
        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
          selected.length === 0
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:text-foreground"
        }`}
      >
        All
      </button>
      {options.map((p) => (
        <button
          key={p.key}
          onClick={() => {
            if (selected.includes(p.key)) {
              onChange(selected.filter((s) => s !== p.key));
            } else {
              onChange([...selected, p.key]);
            }
          }}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
            selected.includes(p.key)
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          {p.key}
        </button>
      ))}
    </div>
  );
}

function AssigneeTable({
  assignees,
}: {
  assignees: { name: string; count: number }[];
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">
        Open Issues by Assignee
      </h3>
      <div className="space-y-1.5">
        {assignees.slice(0, 15).map((a) => (
          <div key={a.name} className="flex items-center gap-3">
            <span className="text-sm text-foreground flex-1 truncate">
              {a.name}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-32 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${Math.min(100, (a.count / assignees[0].count) * 100)}%`,
                  }}
                />
              </div>
              <span className="text-xs text-muted-foreground w-8 text-right">
                {a.count}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
