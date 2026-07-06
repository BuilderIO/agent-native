import {
  callAction,
  useSendToAgentChat,
  useChangeVersions,
  useT,
} from "@agent-native/core/client";
import { Badge } from "@agent-native/toolkit/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-native/toolkit/ui/card";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { IconFlask, IconClock, IconSearch } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

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
  const rows = await callAction("list-analyses", {}, { method: "GET" });
  return (Array.isArray(rows) ? rows : []) as AnalysisSummary[];
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
  const t = useT();
  const analysesSync = useChangeVersions(["analyses", "action"]);
  const { data: analyses, isLoading } = useQuery({
    queryKey: ["analyses-list", analysesSync],
    queryFn: fetchAnalyses,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });

  const { send, codeRequiredDialog } = useSendToAgentChat();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredAnalyses = analyses?.filter((a) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      (a.description && a.description.toLowerCase().includes(q))
    );
  });

  return (
    <>
      {codeRequiredDialog}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground flex-1">
            {t("analyses.description")}
          </p>
          {analyses && analyses.length > 0 && (
            <div className="relative">
              <IconSearch className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
              <input
                type="search"
                placeholder={t("analyses.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 rounded-md border border-input bg-background ps-8 pe-3 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-xl" />
            ))}
          </div>
        ) : !analyses?.length || filteredAnalyses?.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 mb-4">
                <IconFlask className="h-7 w-7 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                {searchQuery
                  ? t("analyses.noResults")
                  : t("analyses.noAnalysesYet")}
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm mb-4">
                {searchQuery
                  ? t("analyses.noResultsForQuery", { query: searchQuery })
                  : t("analyses.emptyDescription")}
              </p>
              {!searchQuery && (
                <button
                  onClick={() =>
                    send({
                      message: t("analyses.examplePrompt"),
                      submit: false,
                    })
                  }
                  className="text-sm text-primary hover:underline"
                >
                  {t("analyses.tryExamplePrompt")}
                </button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(filteredAnalyses ?? analyses ?? []).map((a) => (
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
    </>
  );
}
