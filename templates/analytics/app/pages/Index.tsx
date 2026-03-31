import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Layout } from "@/components/layout/Layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  IconChartBar,
  IconDatabase,
  IconPlus,
  IconArrowRight,
  IconCheck,
  IconCircle,
} from "@tabler/icons-react";
import { getIdToken } from "@/lib/auth";
import {
  dataSources,
  categoryLabels,
  type DataSource,
} from "@/lib/data-sources";
import { dashboards } from "@/pages/adhoc/registry";
import { useSendToAgentChat } from "@agent-native/core/client";
import { useState } from "react";

interface EnvKeyStatus {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
}

async function fetchEnvStatus(): Promise<EnvKeyStatus[]> {
  const token = await getIdToken();
  const res = await fetch("/api/env-status", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  return res.json();
}

function isSourceConnected(
  source: DataSource,
  envStatus: EnvKeyStatus[],
): boolean {
  const statusMap = new Map(envStatus.map((s) => [s.key, s.configured]));
  return source.envKeys.every((key) => statusMap.get(key) === true);
}

function NewDashboardPrompt() {
  const [prompt, setPrompt] = useState("");
  const { send, isGenerating, codeRequiredDialog } = useSendToAgentChat();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;

    const today = new Date().toISOString().slice(0, 10);

    send({
      message: prompt.trim(),
      context:
        "The user wants to create a new analytics dashboard. " +
        `REQUIRED: Set lastUpdated="${today}" in the registry entry. ` +
        "First check /api/env-status to see which data sources are connected. " +
        "Create a new dashboard page in app/pages/adhoc/ with the appropriate charts and data. " +
        "Register it in app/pages/adhoc/registry.ts (both the dashboards array and dashboardComponents map). " +
        "Use the existing chart components from app/components/dashboard/ and Recharts. " +
        "Use the existing server libs for the relevant data source. " +
        "Refer to .builder/skills/<provider>/SKILL.md for query patterns.",
      submit: true,
      requiresCode: true,
    });

    setPrompt("");
  }

  return (
    <>
      {codeRequiredDialog}
      <Card className="bg-card border-border/50 border-dashed">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <IconPlus className="h-4 w-4" />
            Create a Dashboard
          </CardTitle>
          <CardDescription>
            Describe what you want to see and the agent will build it
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='e.g., "Show me a Stripe revenue dashboard with MRR, churn rate, and subscription growth"'
              className="flex w-full rounded-md border border-input bg-background px-3 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 min-h-[100px] resize-y"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  if (prompt.trim()) handleSubmit(e);
                }
              }}
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={!prompt.trim() || isGenerating}
              >
                {isGenerating ? "Generating..." : "Create Dashboard"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}

export default function Index() {
  const { data: envStatus = [] } = useQuery({
    queryKey: ["env-status"],
    queryFn: fetchEnvStatus,
    staleTime: 10_000,
  });

  const connectedSources = dataSources.filter((s) =>
    isSourceConnected(s, envStatus),
  );
  const hasConnections = connectedSources.length > 0;

  return (
    <Layout>
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your data sources, then create custom dashboards with the
            agent.
          </p>
        </div>

        {/* Connected sources summary */}
        {hasConnections && (
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  Connected Sources
                </CardTitle>
                <Link
                  to="/data-sources"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  Manage <IconArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-2">
                {connectedSources.map((source) => {
                  const Icon = source.icon;
                  return (
                    <div
                      key={source.id}
                      className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-600 dark:text-emerald-400"
                    >
                      <Icon className="h-3 w-3" />
                      {source.name}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick start when no sources connected */}
        {!hasConnections && (
          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Get Started</CardTitle>
              <CardDescription>
                Connect a data source to start building dashboards
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  dataSources.find((s) => s.id === "google-analytics"),
                  dataSources.find((s) => s.id === "bigquery"),
                  dataSources.find((s) => s.id === "stripe"),
                ]
                  .filter(Boolean)
                  .map((source) => {
                    const Icon = source!.icon;
                    return (
                      <Link
                        key={source!.id}
                        to="/data-sources"
                        className="flex items-center gap-3 rounded-lg border border-border p-4 hover:bg-accent/50"
                      >
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{source!.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Connect
                          </p>
                        </div>
                      </Link>
                    );
                  })}
              </div>
              <div className="mt-4">
                <Link
                  to="/data-sources"
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                >
                  View all {dataSources.length} data sources{" "}
                  <IconArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Dashboards */}
        {dashboards.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Dashboards
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {dashboards.map((d) => (
                <Link key={d.id} to={`/adhoc/${d.id}`}>
                  <Card className="bg-card border-border/50 hover:border-primary/30 cursor-pointer">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <IconChartBar className="h-4 w-4 text-primary" />
                        <CardTitle className="text-sm">{d.name}</CardTitle>
                      </div>
                    </CardHeader>
                    {d.description && (
                      <CardContent className="pt-0">
                        <p className="text-xs text-muted-foreground">
                          {d.description}
                        </p>
                      </CardContent>
                    )}
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Suggested dashboards based on connected sources */}
        {hasConnections && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Suggested Dashboards
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {connectedSources.slice(0, 4).map((source) => {
                const Icon = source.icon;
                const suggestions: Record<string, string> = {
                  "google-analytics":
                    "Website traffic, top pages, sessions by source",
                  bigquery: "Custom SQL queries and data exploration",
                  amplitude: "User retention, funnel analysis, event trends",
                  mixpanel: "Product usage, user flows, engagement metrics",
                  posthog: "Feature adoption, user paths, session recordings",
                  stripe:
                    "MRR, churn rate, revenue growth, subscription metrics",
                  hubspot: "Deal pipeline, sales velocity, contact activity",
                  github: "PR velocity, review times, contributor activity",
                  jira: "Sprint velocity, ticket backlog, cycle time",
                  sentry: "Error rates, crash-free sessions, performance",
                  grafana: "Service health, latency, error rates",
                  slack: "Channel activity, response times, engagement",
                };
                return (
                  <div
                    key={source.id}
                    className="flex items-center gap-3 rounded-lg border border-dashed border-border p-3 text-muted-foreground"
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">
                        {source.name} Dashboard
                      </p>
                      <p className="text-xs truncate">
                        {suggestions[source.id] || source.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Use the prompt below to create any of these, or describe your own.
            </p>
          </div>
        )}

        {/* New dashboard prompt */}
        <NewDashboardPrompt />
      </div>
    </Layout>
  );
}
