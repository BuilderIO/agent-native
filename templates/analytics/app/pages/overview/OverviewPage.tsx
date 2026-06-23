import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  IconChartBar,
  IconFlask,
  IconClock,
  IconBuilding,
} from "@tabler/icons-react";
import { callAction, useChangeVersions } from "@agent-native/core/client";

type OrgItem = {
  id: string;
  name: string;
  description?: string;
  updatedAt?: string;
  createdAt?: string;
  author?: string;
  type: "dashboard" | "analysis";
};

async function fetchOrgSharedContent(): Promise<OrgItem[]> {
  const [dashRows, analysisRows] = await Promise.allSettled([
    callAction("list-sql-dashboards", {}, { method: "GET" }),
    callAction("list-analyses", {}, { method: "GET" }),
  ]);

  const items: OrgItem[] = [];

  if (dashRows.status === "fulfilled") {
    const rows = Array.isArray(dashRows.value) ? dashRows.value : [];
    const dashboards: OrgItem[] = (rows as any[])
      .filter((d) => d.visibility === "org" || d.visibility === "public")
      .map((d) => ({
        id: d.id,
        name:
          typeof d.name === "string" && d.name.trim()
            ? d.name
            : "Untitled dashboard",
        updatedAt: d.updatedAt ?? undefined,
        createdAt: d.createdAt ?? undefined,
        author: d.author ?? undefined,
        type: "dashboard" as const,
      }));
    items.push(...dashboards);
  }

  if (analysisRows.status === "fulfilled") {
    const rows = Array.isArray(analysisRows.value) ? analysisRows.value : [];
    const analyses: OrgItem[] = (rows as any[])
      .filter((a) => a.visibility === "org" || a.visibility === "public")
      .map((a) => ({
        id: a.id,
        name:
          typeof a.name === "string" && a.name.trim()
            ? a.name
            : "Untitled analysis",
        description: a.description ?? undefined,
        updatedAt: a.updatedAt ?? undefined,
        createdAt: a.createdAt ?? undefined,
        author: a.author ?? undefined,
        type: "analysis" as const,
      }));
    items.push(...analyses);
  }

  const dateOf = (i: OrgItem) =>
    new Date(i.updatedAt ?? i.createdAt ?? 0).getTime();

  return items.sort((a, b) => dateOf(b) - dateOf(a)).slice(0, 6);
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 1) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function OverviewPage() {
  const sync = useChangeVersions(["dashboards", "analyses", "action"]);
  const { data: sharedItems = [], isLoading } = useQuery({
    queryKey: ["org-shared-overview", sync],
    queryFn: fetchOrgSharedContent,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Dashboards and analyses shared with the org
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : sharedItems.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 mb-4">
              <IconBuilding className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Nothing shared yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              When teammates share dashboards or analyses with the org, they
              appear here. Use the ⋯ menu in the sidebar to share any item.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sharedItems.map((item) => (
            <Link
              key={`${item.type}:${item.id}`}
              to={
                item.type === "dashboard"
                  ? `/dashboards/${item.id}`
                  : `/analyses/${item.id}`
              }
              className="block"
            >
              <Card className="h-full hover:border-primary/40 transition-colors cursor-pointer">
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 shrink-0 text-muted-foreground">
                      {item.type === "dashboard" ? (
                        <IconChartBar className="h-4 w-4" />
                      ) : (
                        <IconFlask className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-sm leading-snug">
                        {item.name}
                      </CardTitle>
                      {item.description && (
                        <CardDescription className="text-xs mt-0.5 line-clamp-2">
                          {item.description}
                        </CardDescription>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {item.type === "dashboard" ? "Dashboard" : "Analysis"}
                    </Badge>
                    {item.updatedAt && (
                      <span className="flex items-center gap-1">
                        <IconClock className="h-3 w-3" />
                        {formatRelativeDate(item.updatedAt)}
                      </span>
                    )}
                    {item.author && (
                      <span className="truncate">by {item.author}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
