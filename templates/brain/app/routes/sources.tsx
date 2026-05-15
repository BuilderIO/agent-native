import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconDatabaseImport,
  IconRefresh,
  IconSettings2,
} from "@tabler/icons-react";
import {
  type SourcesResponse,
  formatPercent,
  sampleSources,
  sourceEnabled,
  sourceHealth,
  sourceLastSync,
  sourceName,
  sourceReviewRequired,
  sourceType,
} from "@/lib/brain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  EmptyActionState,
  LoadingRows,
  PageHeader,
  StatusBadge,
} from "@/components/brain/Surface";

export default function SourcesRoute() {
  const [params, setParams] = useSearchParams();
  const type = params.get("type") ?? "all";

  const sourcesQuery = useActionQuery<SourcesResponse>(
    "list-sources" as any,
    {
      provider: type === "all" ? undefined : type,
      includeArchived: false,
    } as any,
  );
  const updateSource = useActionMutation<
    unknown,
    {
      id: string;
      status?: "active" | "paused";
      config?: Record<string, unknown>;
    }
  >("update-source" as any);
  const createSource = useActionMutation<
    unknown,
    {
      title: string;
      provider: "manual" | "generic" | "clips" | "slack" | "granola";
      visibility: "org";
      config: Record<string, unknown>;
    }
  >("create-source" as any);
  const syncSource = useActionMutation<unknown, { sourceId: string }>(
    "sync-source" as any,
  );

  const sources = sourcesQuery.data?.sources?.length
    ? sourcesQuery.data.sources
    : sampleSources;
  const sourceTypes = useMemo(
    () => [
      "all",
      ...Array.from(new Set(sources.map((source) => sourceType(source)))),
    ],
    [sources],
  );
  const visibleSources = sources.filter((source) =>
    type === "all" ? true : sourceType(source) === type,
  );

  function updateType(value: string) {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("type");
    else next.set("type", value);
    setParams(next, { replace: true });
  }

  return (
    <div className="min-h-full bg-background">
      <PageHeader
        eyebrow="Sources"
        title="Source configuration"
        description="Connect, monitor, and tune the sources that feed Brain extraction and cited answers."
        actions={
          <div className="flex gap-2">
            <Select value={type} onValueChange={updateType}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Source type" />
              </SelectTrigger>
              <SelectContent>
                {sourceTypes.map((sourceType) => (
                  <SelectItem key={sourceType} value={sourceType}>
                    {sourceType === "all" ? "All sources" : sourceType}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={createSource.isPending}
              onClick={() =>
                createSource.mutate({
                  title: `${type === "all" ? "Generic" : type} source`,
                  provider:
                    type === "slack" ||
                    type === "granola" ||
                    type === "clips" ||
                    type === "manual"
                      ? type
                      : "generic",
                  visibility: "org",
                  config: {},
                })
              }
            >
              <IconDatabaseImport className="size-4" />
              Add source
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 p-5 lg:grid-cols-3 lg:p-7">
        {sourcesQuery.isLoading ? (
          <div className="lg:col-span-3">
            <LoadingRows rows={3} />
          </div>
        ) : visibleSources.length ? (
          visibleSources.map((source) => (
            <Card key={source.id} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">
                      {sourceName(source)}
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {sourceType(source)}
                    </p>
                  </div>
                  <StatusBadge status={sourceHealth(source)} />
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <p className="min-h-12 text-sm leading-6 text-muted-foreground">
                  {source.description ?? "Company knowledge source."}
                </p>

                <div className="grid gap-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Coverage</span>
                    <span>{formatPercent(source.coverage)}</span>
                  </div>
                  <Progress value={(source.coverage ?? 0) * 100} />
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md border border-border p-3">
                      <p className="text-xs text-muted-foreground">Records</p>
                      <p className="mt-1 font-medium">
                        {(source.recordCount ?? 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-md border border-border p-3">
                      <p className="text-xs text-muted-foreground">Last sync</p>
                      <p className="mt-1 font-medium">
                        {sourceLastSync(source) ?? "Never"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3">
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      Enabled
                      <span className="block text-xs text-muted-foreground">
                        Include in extraction runs
                      </span>
                    </span>
                    <Switch
                      checked={sourceEnabled(source)}
                      onCheckedChange={(enabled) =>
                        updateSource.mutate({
                          id: source.id,
                          status: enabled ? "active" : "paused",
                        })
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      Review required
                      <span className="block text-xs text-muted-foreground">
                        Queue extracted memories before approval
                      </span>
                    </span>
                    <Switch
                      checked={sourceReviewRequired(source)}
                      onCheckedChange={(reviewRequired) =>
                        updateSource.mutate({
                          id: source.id,
                          config: { reviewRequired },
                        })
                      }
                    />
                  </label>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Badge variant="outline">
                    Next: {source.nextSyncAt ?? "manual"}
                  </Badge>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={syncSource.isPending}
                      onClick={() => syncSource.mutate({ sourceId: source.id })}
                    >
                      <IconRefresh className="size-4" />
                      Sync
                    </Button>
                    <Button size="sm" variant="ghost">
                      <IconSettings2 className="size-4" />
                      Tune
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="lg:col-span-3">
            <EmptyActionState
              title="No sources match this filter"
              detail="Choose another type or add a source to start extracting company memory."
            />
          </div>
        )}

        {sourcesQuery.isError ||
        updateSource.isError ||
        createSource.isError ||
        syncSource.isError ? (
          <div className="lg:col-span-3">
            <EmptyActionState
              title="Source actions are not available yet"
              detail="This surface is wired to list-sources, update-source, and sync-source."
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
