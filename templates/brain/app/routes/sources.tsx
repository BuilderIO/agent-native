import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconAlertTriangle,
  IconBrandSlack,
  IconDatabaseImport,
  IconFileText,
  IconNotes,
  IconPlayerPlay,
  IconRefresh,
  IconSettings2,
  IconVideo,
  IconWebhook,
} from "@tabler/icons-react";
import {
  type BrainSource,
  type SlackConnectionResponse,
  type SourcesResponse,
  formatPercent,
  sourceAutoSync,
  sourceDescription,
  sourceEnabled,
  sourceHealth,
  sourceLastSync,
  sourceName,
  sourceRetryAfter,
  sourceReviewRequired,
  sourceType,
} from "@/lib/brain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyActionState,
  LoadingRows,
  PageHeader,
  StatusBadge,
} from "@/components/brain/Surface";

type Provider = "manual" | "generic" | "clips" | "slack" | "granola";

interface SourceFormState {
  title: string;
  provider: Provider;
  channelRefs: string;
  historyLimit: string;
  granolaPageSize: string;
  granolaUpdatedAfter: string;
  pollMinutes: string;
  sourceKey: string;
  autoSync: boolean;
  reviewRequired: boolean;
}

const providers: Array<{
  value: Provider;
  label: string;
  detail: string;
  icon: typeof IconDatabaseImport;
}> = [
  {
    value: "slack",
    label: "Slack",
    detail: "Approved public/private channels only",
    icon: IconBrandSlack,
  },
  {
    value: "granola",
    label: "Granola",
    detail: "Enterprise API Team-space notes",
    icon: IconNotes,
  },
  {
    value: "clips",
    label: "Clips",
    detail: "Recordings exported into Brain",
    icon: IconVideo,
  },
  {
    value: "generic",
    label: "Webhook",
    detail: "Signed transcript and capture imports",
    icon: IconWebhook,
  },
  {
    value: "manual",
    label: "Manual",
    detail: "Agent/UI imports without remote sync",
    icon: IconFileText,
  },
];

function defaultTitle(provider: Provider) {
  switch (provider) {
    case "slack":
      return "Slack knowledge channels";
    case "granola":
      return "Granola team notes";
    case "clips":
      return "Clips exports";
    case "generic":
      return "Generic transcript webhook";
    case "manual":
    default:
      return "Manual imports";
  }
}

function defaultForm(provider: Provider): SourceFormState {
  return {
    title: defaultTitle(provider),
    provider,
    channelRefs: "",
    historyLimit: "15",
    granolaPageSize: "10",
    granolaUpdatedAfter: "",
    pollMinutes: "60",
    sourceKey: provider === "generic" || provider === "clips" ? provider : "",
    autoSync: provider === "slack" || provider === "granola",
    reviewRequired: true,
  };
}

function listValue(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).join("\n");
  return typeof value === "string" ? value : "";
}

function formFromSource(source: BrainSource): SourceFormState {
  const provider = (source.provider ?? "generic") as Provider;
  const config = source.config ?? {};
  return {
    ...defaultForm(provider),
    title: sourceName(source),
    channelRefs: listValue(
      config.channelIds ?? config.channels ?? config.allowedChannels,
    ),
    historyLimit:
      typeof config.historyLimit === "number" ||
      typeof config.historyLimit === "string"
        ? String(config.historyLimit)
        : "15",
    granolaPageSize:
      typeof config.pageSize === "number" || typeof config.pageSize === "string"
        ? String(config.pageSize)
        : "10",
    granolaUpdatedAfter:
      typeof config.updatedAfter === "string" ? config.updatedAfter : "",
    pollMinutes:
      typeof config.pollMinutes === "number" ||
      typeof config.pollMinutes === "string"
        ? String(config.pollMinutes)
        : "60",
    sourceKey: "",
    autoSync: sourceAutoSync(source),
    reviewRequired: sourceReviewRequired(source),
  };
}

function splitLines(value: string) {
  return value
    .split(/[\n,]/g)
    .map((item) => item.trim().replace(/^#/, ""))
    .filter(Boolean);
}

function numberValue(
  value: string,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function buildConfig(form: SourceFormState) {
  const config: Record<string, unknown> = {
    reviewRequired: form.reviewRequired,
    autoSync: form.autoSync,
    pollMinutes: numberValue(form.pollMinutes, 60, 5, 1440),
  };
  if (form.provider === "slack") {
    config.channelIds = splitLines(form.channelRefs);
    config.historyLimit = numberValue(form.historyLimit, 15, 1, 15);
  }
  if (form.provider === "granola") {
    config.pageSize = numberValue(form.granolaPageSize, 10, 1, 30);
    if (form.granolaUpdatedAfter.trim()) {
      config.updatedAfter = form.granolaUpdatedAfter.trim();
    }
  }
  if (form.sourceKey.trim()) config.sourceKey = form.sourceKey.trim();
  return config;
}

function sourceProviderIcon(provider?: string) {
  return (
    providers.find((item) => item.value === provider)?.icon ?? IconFileText
  );
}

function shortDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function syncDetail(source: BrainSource) {
  const retry = sourceRetryAfter(source);
  if (retry) return `Retry after ${shortDate(retry) ?? retry}`;
  if (source.lastError) return source.lastError;
  if (source.latestRun?.status === "error") {
    return source.latestRun.error ?? "Last sync failed";
  }
  if (source.nextSyncAt) return `Next ${shortDate(source.nextSyncAt)}`;
  return sourceAutoSync(source) ? "Waiting for first sync" : "Manual sync";
}

export default function SourcesRoute() {
  const [params, setParams] = useSearchParams();
  const type = params.get("type") ?? "all";
  const [setupOpen, setSetupOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<BrainSource | null>(null);
  const [form, setForm] = useState<SourceFormState>(() => defaultForm("slack"));
  const [slackTestResult, setSlackTestResult] =
    useState<SlackConnectionResponse | null>(null);

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
      title?: string;
      status?: "active" | "paused";
      config?: Record<string, unknown>;
    }
  >("update-source" as any);
  const createSource = useActionMutation<
    unknown,
    {
      title: string;
      provider: Provider;
      visibility: "org";
      config: Record<string, unknown>;
      sourceKey?: string;
    }
  >("create-source" as any);
  const syncSource = useActionMutation<unknown, { sourceId: string }>(
    "sync-source" as any,
  );
  const syncDueSources = useActionMutation<unknown, { limit: number }>(
    "sync-due-sources" as any,
  );
  const testSlackConnection = useActionMutation<
    SlackConnectionResponse,
    { sourceId: string; resolveNames: boolean }
  >("test-slack-connection" as any);

  const sources = sourcesQuery.data?.sources ?? [];
  const sourceTypes = useMemo(
    () => [
      "all",
      ...Array.from(
        new Set([
          ...providers.map((provider) => provider.value),
          ...sources.map((source) => sourceType(source)),
        ]),
      ),
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

  function openCreate(provider?: Provider) {
    const selected =
      provider ??
      (type === "slack" ||
      type === "granola" ||
      type === "clips" ||
      type === "manual" ||
      type === "generic"
        ? (type as Provider)
        : "slack");
    setEditingSource(null);
    setForm(defaultForm(selected));
    setSetupOpen(true);
  }

  function openEdit(source: BrainSource) {
    setEditingSource(source);
    setForm(formFromSource(source));
    setSetupOpen(true);
  }

  function updateForm(patch: Partial<SourceFormState>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function submitSource() {
    const config = buildConfig(form);
    if (editingSource) {
      updateSource.mutate({
        id: editingSource.id,
        title: form.title.trim() || defaultTitle(form.provider),
        status:
          form.autoSync || sourceEnabled(editingSource) ? "active" : "paused",
        config,
      });
    } else {
      createSource.mutate({
        title: form.title.trim() || defaultTitle(form.provider),
        provider: form.provider,
        visibility: "org",
        config,
        sourceKey: form.sourceKey.trim() || undefined,
      });
    }
    setSetupOpen(false);
  }

  async function runSlackCredentialTest(source: BrainSource) {
    const result = await testSlackConnection.mutateAsync({
      sourceId: source.id,
      resolveNames: false,
    });
    setSlackTestResult(result);
  }

  return (
    <div className="min-h-full bg-background">
      <PageHeader
        eyebrow="Sources"
        title="Source configuration"
        description="Connect approved Slack channels, Granola notes, Clips exports, and signed transcript feeds."
        actions={
          <div className="flex flex-wrap gap-2">
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
              variant="outline"
              disabled={syncDueSources.isPending}
              onClick={() => syncDueSources.mutate({ limit: 5 })}
            >
              <IconPlayerPlay className="size-4" />
              Run due
            </Button>
            <Button
              size="sm"
              disabled={createSource.isPending}
              onClick={() => openCreate()}
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
          visibleSources.map((source) => {
            const Icon = sourceProviderIcon(source.provider);
            const retry = sourceRetryAfter(source);
            return (
              <Card key={source.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50">
                        <Icon className="size-4 text-muted-foreground" />
                      </span>
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">
                          {sourceName(source)}
                        </CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {sourceType(source)}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={sourceHealth(source)} />
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <p className="min-h-12 text-sm leading-6 text-muted-foreground">
                    {sourceDescription(source)}
                  </p>

                  <div className="grid gap-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Coverage</span>
                      <span>{formatPercent(source.coverage)}</span>
                    </div>
                    <Progress value={(source.coverage ?? 0) * 100} />
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-md border border-border p-3">
                        <p className="text-xs text-muted-foreground">
                          Captures
                        </p>
                        <p className="mt-1 font-medium">
                          {(source.recordCount ?? 0).toLocaleString()}
                        </p>
                      </div>
                      <div className="rounded-md border border-border p-3">
                        <p className="text-xs text-muted-foreground">
                          Last sync
                        </p>
                        <p className="mt-1 font-medium">
                          {shortDate(sourceLastSync(source)) ?? "Never"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3">
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        Enabled
                        <span className="block text-xs text-muted-foreground">
                          Include in manual and scheduled syncs
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
                        Auto-sync
                        <span className="block text-xs text-muted-foreground">
                          Poll on the background schedule
                        </span>
                      </span>
                      <Switch
                        checked={sourceAutoSync(source)}
                        onCheckedChange={(autoSync) =>
                          updateSource.mutate({
                            id: source.id,
                            config: { autoSync },
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

                  {(source.lastError || retry || source.latestRun) && (
                    <div className="flex gap-2 rounded-md border border-border bg-background p-3 text-sm">
                      <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <p className="leading-5 text-muted-foreground">
                        {syncDetail(source)}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    <Badge variant="outline">
                      {source.nextSyncAt
                        ? `Next ${shortDate(source.nextSyncAt)}`
                        : "Manual"}
                    </Badge>
                    <div className="flex gap-2">
                      {source.provider === "slack" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={testSlackConnection.isPending}
                          onClick={() => runSlackCredentialTest(source)}
                        >
                          <IconBrandSlack className="size-4" />
                          Test
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={syncSource.isPending}
                        onClick={() =>
                          syncSource.mutate({ sourceId: source.id })
                        }
                      >
                        <IconRefresh className="size-4" />
                        Sync
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(source)}
                      >
                        <IconSettings2 className="size-4" />
                        Tune
                      </Button>
                    </div>
                  </div>

                  {slackTestResult?.sourceId === source.id ? (
                    <div className="rounded-md border border-border bg-background p-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">
                          Slack token OK
                          {slackTestResult.team
                            ? ` for ${slackTestResult.team}`
                            : ""}
                        </p>
                        <Badge variant="secondary">No history read</Badge>
                      </div>
                      <div className="mt-3 grid gap-2">
                        {slackTestResult.channels.length ? (
                          slackTestResult.channels.map((channel) => (
                            <div
                              key={channel.ref}
                              className="flex items-start justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium">
                                  {channel.name
                                    ? `#${channel.name}`
                                    : channel.ref}
                                </p>
                                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                  {channel.message}
                                </p>
                              </div>
                              <Badge
                                variant={
                                  channel.status === "ok"
                                    ? "secondary"
                                    : "outline"
                                }
                              >
                                {channel.status}
                              </Badge>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs leading-5 text-muted-foreground">
                            Credential smoke only. Add channel IDs to validate
                            allow-list safety.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })
        ) : (
          <div className="lg:col-span-3">
            <EmptyActionState
              title="Connect Brain's first source"
              detail="Start with Slack channels for product decisions, Granola Team-space notes, Clips exports, or a signed webhook."
            />
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {providers.map((provider) => {
                const Icon = provider.icon;
                return (
                  <button
                    key={provider.value}
                    type="button"
                    onClick={() => openCreate(provider.value)}
                    className="rounded-md border border-border bg-card p-4 text-left transition hover:border-primary/50 hover:bg-muted/40"
                  >
                    <Icon className="size-5 text-muted-foreground" />
                    <p className="mt-3 font-medium">{provider.label}</p>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">
                      {provider.detail}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {sourcesQuery.isError ||
        updateSource.isError ||
        createSource.isError ||
        syncSource.isError ||
        syncDueSources.isError ||
        testSlackConnection.isError ? (
          <div className="lg:col-span-3">
            <EmptyActionState
              title="Source action failed"
              detail="Check source credentials, channel allow-lists, and the latest sync error."
            />
          </div>
        ) : null}
      </div>

      <Sheet open={setupOpen} onOpenChange={setSetupOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>
              {editingSource ? "Tune source" : "Add source"}
            </SheetTitle>
            <SheetDescription>
              Configure what Brain may ingest. Credentials stay in the workspace
              credential store; this form only saves source rules.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="source-title">Name</Label>
              <Input
                id="source-title"
                value={form.title}
                onChange={(event) => updateForm({ title: event.target.value })}
              />
            </div>

            <div className="grid gap-2">
              <Label>Provider</Label>
              <Select
                value={form.provider}
                disabled={!!editingSource}
                onValueChange={(provider) =>
                  setForm((current) => ({
                    ...defaultForm(provider as Provider),
                    title:
                      current.title === defaultTitle(current.provider)
                        ? defaultTitle(provider as Provider)
                        : current.title,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((provider) => (
                    <SelectItem key={provider.value} value={provider.value}>
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.provider === "slack" && (
              <div className="grid gap-4 rounded-md border border-border p-4">
                <div className="grid gap-2">
                  <Label htmlFor="slack-channels">Allowed channels</Label>
                  <Textarea
                    id="slack-channels"
                    value={form.channelRefs}
                    onChange={(event) =>
                      updateForm({ channelRefs: event.target.value })
                    }
                    placeholder={"C0123456789\n#product\n#launches"}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    Brain verifies each channel and rejects DMs/MPIMs before
                    reading history.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="history-limit">Messages per page</Label>
                    <Input
                      id="history-limit"
                      type="number"
                      min={1}
                      max={15}
                      value={form.historyLimit}
                      onChange={(event) =>
                        updateForm({ historyLimit: event.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="poll-minutes">Poll minutes</Label>
                    <Input
                      id="poll-minutes"
                      type="number"
                      min={5}
                      max={1440}
                      value={form.pollMinutes}
                      onChange={(event) =>
                        updateForm({ pollMinutes: event.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {form.provider === "granola" && (
              <div className="grid gap-4 rounded-md border border-border p-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="granola-page-size">Page size</Label>
                    <Input
                      id="granola-page-size"
                      type="number"
                      min={1}
                      max={30}
                      value={form.granolaPageSize}
                      onChange={(event) =>
                        updateForm({ granolaPageSize: event.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="granola-poll-minutes">Poll minutes</Label>
                    <Input
                      id="granola-poll-minutes"
                      type="number"
                      min={5}
                      max={1440}
                      value={form.pollMinutes}
                      onChange={(event) =>
                        updateForm({ pollMinutes: event.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="granola-updated-after">
                    Initial updated-after
                  </Label>
                  <Input
                    id="granola-updated-after"
                    value={form.granolaUpdatedAfter}
                    onChange={(event) =>
                      updateForm({ granolaUpdatedAfter: event.target.value })
                    }
                    placeholder="2026-05-01T00:00:00.000Z"
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    Granola Enterprise API returns Team-space notes; private
                    notes are outside the API scope.
                  </p>
                </div>
              </div>
            )}

            {(form.provider === "generic" || form.provider === "clips") && (
              <div className="grid gap-4 rounded-md border border-border p-4">
                <div className="grid gap-2">
                  <Label htmlFor="source-key">Webhook source key</Label>
                  <Input
                    id="source-key"
                    value={form.sourceKey}
                    onChange={(event) =>
                      updateForm({ sourceKey: event.target.value })
                    }
                    placeholder={form.provider}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    New sources receive a one-time ingest token. Existing
                    sources keep their token unless rotated separately.
                  </p>
                </div>
              </div>
            )}

            <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-4">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Auto-sync
                  <span className="block text-xs text-muted-foreground">
                    Background polling uses this source when due
                  </span>
                </span>
                <Switch
                  checked={form.autoSync}
                  onCheckedChange={(autoSync) => updateForm({ autoSync })}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Review required
                  <span className="block text-xs text-muted-foreground">
                    Queue extracted knowledge before approval
                  </span>
                </span>
                <Switch
                  checked={form.reviewRequired}
                  onCheckedChange={(reviewRequired) =>
                    updateForm({ reviewRequired })
                  }
                />
              </label>
            </div>
          </div>

          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setSetupOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitSource}
              disabled={
                createSource.isPending ||
                updateSource.isPending ||
                !form.title.trim()
              }
            >
              {editingSource ? "Save source" : "Create source"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
