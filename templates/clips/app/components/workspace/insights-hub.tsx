import { appBasePath, useActionQuery, useT } from "@agent-native/core/client";
import {
  IconAlertTriangle,
  IconChartLine,
  IconDownload,
  IconUsers,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/library/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { EngagementChart } from "./engagement-chart";
import { TopCreatorsTable } from "./top-creators-table";
import { TopVideosTable } from "./top-videos-table";

interface InsightsResponse {
  organizationId: string | null;
  period: { days: number; start: string | null; end: string | null };
  totals: {
    views: number;
    reactions: number;
    comments: number;
    recordings: number;
  };
  topVideos: {
    byViews: { id: string; title: string; count: number }[];
    byReactions: { id: string; title: string; count: number }[];
    byComments: { id: string; title: string; count: number }[];
  };
  topCreators: {
    email: string;
    recordings: number;
    views: number;
    engagement: number;
  }[];
  trend: {
    date: string;
    views: number;
    reactions: number;
    comments: number;
  }[];
}

export function InsightsHub() {
  const t = useT();
  const [days, setDays] = useState("30");
  const { data, isLoading, isError, isFetching, refetch } =
    useActionQuery<InsightsResponse>("get-organization-insights", {
      days: Number(days),
    } as any);

  const totals = data?.totals ?? {
    views: 0,
    reactions: 0,
    comments: 0,
    recordings: 0,
  };

  const csvUrl = useMemo(() => {
    const base = `${appBasePath()}/api/insights/export`;
    if (!data?.organizationId) return base;
    return `${base}?organizationId=${encodeURIComponent(data.organizationId)}`;
  }, [data?.organizationId]);

  return (
    <>
      <PageHeader>
        <h1 className="text-base font-semibold tracking-tight truncate">
          {t("insightsHub.title")}
        </h1>
        <div className="ms-auto flex items-center gap-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="h-8 w-36">
              <SelectValue placeholder={t("insightsHub.period")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">{t("insightsHub.last7Days")}</SelectItem>
              <SelectItem value="14">{t("insightsHub.last14Days")}</SelectItem>
              <SelectItem value="30">{t("insightsHub.last30Days")}</SelectItem>
              <SelectItem value="90">{t("insightsHub.last90Days")}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8" asChild>
            <a href={csvUrl} download>
              <IconDownload className="size-4 me-1.5" />
              {t("insightsHub.exportCsv")}
            </a>
          </Button>
        </div>
      </PageHeader>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <p className="text-sm text-muted-foreground">
          {t("insightsHub.description", { days })}
        </p>

        {isError ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 px-6 py-16 text-center">
            <IconAlertTriangle className="size-9 text-destructive" />
            <p className="text-sm font-medium">
              {t("libraryGrid.loadFailedTitle")}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              {t("libraryGrid.retry")}
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                label={t("insightsHub.views")}
                value={totals.views}
                loading={isLoading}
              />
              <StatCard
                label={t("insightsHub.reactions")}
                value={totals.reactions}
                loading={isLoading}
              />
              <StatCard
                label={t("insightsHub.comments")}
                value={totals.comments}
                loading={isLoading}
              />
              <StatCard
                label={t("insightsHub.recordings")}
                value={totals.recordings}
                loading={isLoading}
              />
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <IconChartLine className="size-4 text-primary" />
                  {t("insightsHub.engagementTrend")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <EngagementChart data={data?.trend ?? []} />
                )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {t("insightsHub.topVideos")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="views">
                    <TabsList>
                      <TabsTrigger value="views">
                        {t("insightsHub.views")}
                      </TabsTrigger>
                      <TabsTrigger value="reactions">
                        {t("insightsHub.reactions")}
                      </TabsTrigger>
                      <TabsTrigger value="comments">
                        {t("insightsHub.comments")}
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="views" className="pt-3">
                      <TopVideosTable
                        rows={data?.topVideos.byViews ?? []}
                        metricLabel={t("insightsHub.views")}
                      />
                    </TabsContent>
                    <TabsContent value="reactions" className="pt-3">
                      <TopVideosTable
                        rows={data?.topVideos.byReactions ?? []}
                        metricLabel={t("insightsHub.reactions")}
                      />
                    </TabsContent>
                    <TabsContent value="comments" className="pt-3">
                      <TopVideosTable
                        rows={data?.topVideos.byComments ?? []}
                        metricLabel={t("insightsHub.comments")}
                      />
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <IconUsers className="size-4 text-primary" />
                    {t("insightsHub.topCreators")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <TopCreatorsTable rows={data?.topCreators ?? []} />
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: number;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {loading ? (
          <Skeleton className="h-7 w-16 mt-1" />
        ) : (
          <div className="text-2xl font-semibold tabular-nums mt-1">
            {value.toLocaleString()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
