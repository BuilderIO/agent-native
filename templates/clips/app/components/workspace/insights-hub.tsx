import { useMemo, useState } from "react";
import {
  IconChartBar,
  IconChartLine,
  IconDownload,
  IconUsers,
} from "@tabler/icons-react";
import { appBasePath, useActionQuery } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EngagementChart } from "./engagement-chart";
import { TopVideosTable } from "./top-videos-table";
import { TopCreatorsTable } from "./top-creators-table";

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
  const [days, setDays] = useState("30");
  const { data, isLoading } = useActionQuery<InsightsResponse>(
    "get-organization-insights",
    { days: Number(days) } as any,
  );

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
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <IconChartBar className="size-6 text-primary" />
            Insights
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Engagement across your organization over the last {days} days.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" asChild>
            <a href={csvUrl} download>
              <IconDownload className="size-4 mr-1.5" />
              Export CSV
            </a>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Views" value={totals.views} loading={isLoading} />
        <StatCard
          label="Reactions"
          value={totals.reactions}
          loading={isLoading}
        />
        <StatCard
          label="Comments"
          value={totals.comments}
          loading={isLoading}
        />
        <StatCard
          label="Recordings"
          value={totals.recordings}
          loading={isLoading}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <IconChartLine className="size-4 text-primary" />
            Engagement trend
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
            <CardTitle className="text-base">Top videos</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="views">
              <TabsList>
                <TabsTrigger value="views">Views</TabsTrigger>
                <TabsTrigger value="reactions">Reactions</TabsTrigger>
                <TabsTrigger value="comments">Comments</TabsTrigger>
              </TabsList>
              <TabsContent value="views" className="pt-3">
                <TopVideosTable
                  rows={data?.topVideos.byViews ?? []}
                  metricLabel="Views"
                />
              </TabsContent>
              <TabsContent value="reactions" className="pt-3">
                <TopVideosTable
                  rows={data?.topVideos.byReactions ?? []}
                  metricLabel="Reactions"
                />
              </TabsContent>
              <TabsContent value="comments" className="pt-3">
                <TopVideosTable
                  rows={data?.topVideos.byComments ?? []}
                  metricLabel="Comments"
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <IconUsers className="size-4 text-primary" />
              Top creators
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TopCreatorsTable rows={data?.topCreators ?? []} />
          </CardContent>
        </Card>
      </div>
    </div>
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
