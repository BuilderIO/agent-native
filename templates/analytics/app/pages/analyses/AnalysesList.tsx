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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { IconFlask, IconClock, IconDatabase } from "@tabler/icons-react";
import { getIdToken } from "@/lib/auth";
import { useSendToAgentChat } from "@agent-native/core/client";

interface AnalysisSummary {
  id: string;
  name: string;
  description: string;
  dataSources: string[];
  createdAt: string;
  updatedAt: string;
  author: string;
}

async function fetchAnalyses(): Promise<AnalysisSummary[]> {
  const token = await getIdToken();
  const res = await fetch("/api/analyses", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.analyses ?? [];
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function AnalysesList() {
  const { data: analyses, isLoading } = useQuery({
    queryKey: ["analyses-list"],
    queryFn: fetchAnalyses,
    staleTime: 10_000,
  });

  const { send, codeRequiredDialog } = useSendToAgentChat();

  return (
    <Layout>
      {codeRequiredDialog}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Analyses</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Ad-hoc analyses that can be re-run anytime for fresh results
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-xl" />
            ))}
          </div>
        ) : !analyses?.length ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 mb-4">
                <IconFlask className="h-7 w-7 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No analyses yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm mb-4">
                Ask the AI assistant to run an analysis — for example, "Analyze
                our closed-lost deals from Q1 and cross-reference with Gong call
                data" — and it will save the results here.
              </p>
              <button
                onClick={() =>
                  send({
                    message:
                      "Run an ad-hoc analysis on our top opportunities — pull data from available sources and summarize key findings",
                    submit: false,
                  })
                }
                className="text-sm text-primary hover:underline"
              >
                Try an example prompt
              </button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {analyses.map((a) => (
              <Link key={a.id} to={`/analyses/${a.id}`} className="block">
                <Card className="h-full hover:border-primary/40 transition-colors cursor-pointer">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base leading-snug">
                      {a.name}
                    </CardTitle>
                    {a.description && (
                      <CardDescription className="line-clamp-2 text-xs">
                        {a.description}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {a.dataSources?.map((ds) => (
                        <Badge
                          key={ds}
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0"
                        >
                          {ds}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <IconClock className="h-3 w-3" />
                        {formatRelativeDate(a.updatedAt)}
                      </span>
                      {a.author && (
                        <span className="truncate">by {a.author}</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
