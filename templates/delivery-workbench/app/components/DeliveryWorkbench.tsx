import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconExternalLink,
  IconFilter,
  IconHash,
  IconInbox,
  IconRefresh,
  IconTag,
  IconUserCheck,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type WorkItemStatus = "open" | "in_progress" | "blocked" | "done" | "cancelled";
type WorkItemPriority = "low" | "normal" | "high" | "urgent";

interface WorkItemSummary {
  id: string;
  provider: string;
  sourceId: string;
  sourceUrl: string | null;
  title: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  assigneeEmail: string | null;
  teamId: string | null;
  tags: string[];
  sourceUpdatedAt: string | null;
  dueAt: string | null;
  updatedAt: string;
}

interface WorkItemDetail extends WorkItemSummary {
  body: string | null;
  metadata: Record<string, unknown>;
  lastSnapshotHash: string | null;
  lastIngestRunId: string | null;
  recentSnapshots: Array<{
    id: string;
    ingestRunId: string;
    snapshotHash: string;
    rawRef: string | null;
    capturedAt: string;
    changed: boolean;
  }>;
  routingSuggestions: Array<{
    id: string;
    suggestedAssigneeEmail: string | null;
    suggestedTeamId: string | null;
    reason: string;
    confidence: number;
    createdAt: string;
  }>;
}

const statusValues: WorkItemStatus[] = [
  "open",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
];

const priorityValues: WorkItemPriority[] = ["low", "normal", "high", "urgent"];

const statusLabelKey: Record<WorkItemStatus, string> = {
  open: "status.open",
  in_progress: "status.inProgress",
  blocked: "status.blocked",
  done: "status.done",
  cancelled: "status.cancelled",
};

const priorityLabelKey: Record<WorkItemPriority, string> = {
  low: "priority.low",
  normal: "priority.normal",
  high: "priority.high",
  urgent: "priority.urgent",
};

const statusClass: Record<WorkItemStatus, string> = {
  open: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  in_progress: "border-primary/30 bg-primary/10 text-primary dark:text-primary",
  blocked:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  done: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  cancelled: "border-muted bg-muted text-muted-foreground",
};

const priorityClass: Record<WorkItemPriority, string> = {
  low: "border-muted bg-muted text-muted-foreground",
  normal: "border-border bg-background text-foreground",
  high: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  urgent: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
};

function compactArgs(args: Record<string, string | number | undefined>) {
  return Object.fromEntries(
    Object.entries(args).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  );
}

function formatRelative(value: string | null | undefined) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const delta = date.getTime() - Date.now();
  const abs = Math.abs(delta);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const suffix = delta < 0 ? "ago" : "left";
  if (minutes < 60) return `${minutes}m ${suffix}`;
  if (hours < 36) return `${hours}h ${suffix}`;
  return `${days}d ${suffix}`;
}

function dueRisk(item: Pick<WorkItemSummary, "dueAt" | "priority" | "status">) {
  if (item.status === "done" || item.status === "cancelled") return "clear";
  if (item.priority === "urgent") return "urgent";
  if (!item.dueAt) return "none";
  const due = new Date(item.dueAt).getTime();
  if (Number.isNaN(due)) return "none";
  const hours = (due - Date.now()) / 3600000;
  if (hours < 0) return "overdue";
  if (hours <= 24) return "due-soon";
  return "clear";
}

function WorkItemBadge({
  value,
  type,
}: {
  value: WorkItemStatus | WorkItemPriority;
  type: "status" | "priority";
}) {
  const t = useT();
  return (
    <Badge
      variant="outline"
      className={cn(
        "whitespace-nowrap",
        type === "status"
          ? statusClass[value as WorkItemStatus]
          : priorityClass[value as WorkItemPriority],
      )}
    >
      {type === "status"
        ? t(statusLabelKey[value as WorkItemStatus])
        : t(priorityLabelKey[value as WorkItemPriority])}
    </Badge>
  );
}

function RiskSignal({ item }: { item: WorkItemSummary }) {
  const t = useT();
  const risk = dueRisk(item);
  if (risk === "clear") {
    return <span className="text-muted-foreground">{t("risk.onTrack")}</span>;
  }
  if (risk === "none") {
    return <span className="text-muted-foreground">{t("risk.noSla")}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300">
      <IconAlertTriangle className="size-3.5" />
      {risk === "overdue"
        ? t("risk.overdue")
        : risk === "urgent"
          ? t("risk.urgent")
          : t("risk.dueSoon")}
    </span>
  );
}

function FilterSelect({
  value,
  placeholder,
  options,
  onChange,
}: {
  value?: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <Select
      value={value ?? "all"}
      onValueChange={(next) => onChange(next === "all" ? undefined : next)}
    >
      <SelectTrigger className="h-8">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="all">{placeholder}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function QueueSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: 7 }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

function SourceLink({ url }: { url: string | null }) {
  const t = useT();
  if (!url) {
    return <span className="text-muted-foreground">{t("source.noUrl")}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="sm" asChild>
          <a href={url} target="_blank" rel="noreferrer">
            <IconExternalLink />
            {t("source.open")}
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("source.openTooltip")}</TooltipContent>
    </Tooltip>
  );
}

function DetailActions({
  item,
  onPatch,
}: {
  item: WorkItemDetail;
  onPatch: (patch: Partial<WorkItemDetail>) => void;
}) {
  const t = useT();
  const [assignee, setAssignee] = useState(item.assigneeEmail ?? "");
  const [tags, setTags] = useState(item.tags.join(", "));

  useEffect(() => {
    setAssignee(item.assigneeEmail ?? "");
    setTags(item.tags.join(", "));
  }, [item.id, item.assigneeEmail, item.tags]);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
        {t("detail.status")}
        <Select
          value={item.status}
          onValueChange={(status) =>
            onPatch({ status: status as WorkItemStatus })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {statusValues.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(statusLabelKey[status])}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </label>
      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
        {t("detail.priority")}
        <Select
          value={item.priority}
          onValueChange={(priority) =>
            onPatch({ priority: priority as WorkItemPriority })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {priorityValues.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {t(priorityLabelKey[priority])}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </label>
      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
        {t("detail.assignee")}
        <div className="flex gap-2">
          <Input
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            placeholder={t("detail.assigneePlaceholder")}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() =>
              onPatch({ assigneeEmail: assignee.trim() || null } as any)
            }
            aria-label={t("detail.saveAssignee")}
          >
            <IconUserCheck />
          </Button>
        </div>
      </label>
      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
        {t("detail.tags")}
        <div className="flex gap-2">
          <Input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder={t("detail.tagsPlaceholder")}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() =>
              onPatch({
                tags: tags
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              } as any)
            }
            aria-label={t("detail.saveTags")}
          >
            <IconTag />
          </Button>
        </div>
      </label>
    </div>
  );
}

function EmptyDetail() {
  const t = useT();
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div className="max-w-sm space-y-2">
        <IconInbox className="mx-auto size-8 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t("empty.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("empty.description")}
        </p>
      </div>
    </div>
  );
}

export function DeliveryWorkbench() {
  const t = useT();
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = params.id;

  const filters = useMemo(
    () => ({
      status: searchParams.get("status") || undefined,
      priority: searchParams.get("priority") || undefined,
      provider: searchParams.get("provider") || undefined,
      assigneeEmail: searchParams.get("assignee") || undefined,
      tag: searchParams.get("tag") || undefined,
      search: searchParams.get("q") || undefined,
      limit: 100,
    }),
    [searchParams],
  );

  const queueQuery = useActionQuery<WorkItemSummary[]>(
    "list-work-items" as any,
    compactArgs(filters) as any,
    { refetchInterval: 5000 },
  );
  const detailQuery = useActionQuery<WorkItemDetail>(
    "get-work-item" as any,
    { id: selectedId ?? "" } as any,
    { enabled: Boolean(selectedId), refetchInterval: 5000 },
  );
  const updateItem = useActionMutation<WorkItemDetail, Record<string, unknown>>(
    "update-work-item" as any,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["action"] });
      },
    },
  );

  const items = queueQuery.data ?? [];
  const selectedItem = detailQuery.data;

  function setFilter(key: string, value: string | undefined) {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }

  function patchSelected(patch: Record<string, unknown>) {
    if (!selectedId) return;
    updateItem.mutate({ id: selectedId, ...patch });
  }

  return (
    <section className="flex h-full flex-col overflow-auto lg:overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconInbox className="size-5 text-primary" />
            <h1 className="truncate text-sm font-semibold">
              {t("queue.title")}
            </h1>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {t("queue.syncedSummary", { count: items.length })}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={() => queueQuery.refetch()}
              aria-label={t("queue.refresh")}
            >
              <IconRefresh />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("queue.refresh")}</TooltipContent>
        </Tooltip>
      </header>
      <div className="grid flex-none grid-cols-1 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(340px,460px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(360px,500px)_minmax(420px,1fr)_320px]">
        <aside className="border-b border-border lg:row-span-2 lg:min-h-0 lg:border-b-0 lg:border-r 2xl:row-span-1">
          <div className="border-b border-border p-3">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <IconFilter className="size-4" />
              {t("queue.filters")}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={filters.search ?? ""}
                onChange={(event) => setFilter("q", event.target.value)}
                placeholder={t("queue.searchPlaceholder")}
                className="col-span-2 h-8"
              />
              <FilterSelect
                value={filters.status}
                placeholder={t("queue.anyStatus")}
                options={statusValues.map((value) => ({
                  value,
                  label: t(statusLabelKey[value]),
                }))}
                onChange={(value) => setFilter("status", value)}
              />
              <FilterSelect
                value={filters.priority}
                placeholder={t("queue.anyPriority")}
                options={priorityValues.map((value) => ({
                  value,
                  label: t(priorityLabelKey[value]),
                }))}
                onChange={(value) => setFilter("priority", value)}
              />
              <Input
                value={filters.provider ?? ""}
                onChange={(event) => setFilter("provider", event.target.value)}
                placeholder={t("queue.providerPlaceholder")}
                className="h-8"
              />
              <Input
                value={filters.assigneeEmail ?? ""}
                onChange={(event) => setFilter("assignee", event.target.value)}
                placeholder={t("queue.assigneePlaceholder")}
                className="h-8"
              />
            </div>
          </div>
          <div className="overflow-visible lg:min-h-0 lg:overflow-auto">
            {queueQuery.isLoading ? (
              <QueueSkeleton />
            ) : items.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                {t("queue.empty")}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("queue.columnItem")}</TableHead>
                    <TableHead>{t("queue.columnStatus")}</TableHead>
                    <TableHead>{t("queue.columnSla")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow
                      key={item.id}
                      data-state={
                        item.id === selectedId ? "selected" : undefined
                      }
                      className="cursor-pointer"
                      onClick={() => navigate(`/work-items/${item.id}`)}
                    >
                      <TableCell className="max-w-[220px]">
                        <div className="truncate font-medium">{item.title}</div>
                        <div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                          <span className="truncate">{item.provider}</span>
                          <span>/</span>
                          <span className="truncate">{item.sourceId}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <WorkItemBadge value={item.status} type="status" />
                          <WorkItemBadge
                            value={item.priority}
                            type="priority"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <RiskSignal item={item} />
                        <div className="mt-1 text-muted-foreground">
                          {formatRelative(item.dueAt)}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </aside>
        <main className="overflow-visible border-b border-border lg:min-h-0 lg:overflow-auto 2xl:border-b-0 2xl:border-r">
          {!selectedId ? (
            <EmptyDetail />
          ) : detailQuery.isLoading ? (
            <div className="space-y-4 p-5">
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : !selectedItem ? (
            <div className="p-6 text-sm text-muted-foreground">
              {t("detail.notFound")}
            </div>
          ) : (
            <div className="space-y-5 p-5">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <WorkItemBadge value={selectedItem.status} type="status" />
                  <WorkItemBadge
                    value={selectedItem.priority}
                    type="priority"
                  />
                  <span className="text-xs text-muted-foreground">
                    {t("detail.updated")}{" "}
                    {formatRelative(selectedItem.updatedAt)}
                  </span>
                </div>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">
                    {selectedItem.title}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedItem.provider} / {selectedItem.sourceId}
                  </p>
                </div>
                <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-sm leading-6">
                  {selectedItem.body || t("detail.noDescription")}
                </p>
              </div>
              <Separator />
              <DetailActions item={selectedItem} onPatch={patchSelected} />
              <Separator />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-border p-3">
                  <div className="text-xs font-medium text-muted-foreground">
                    {t("detail.owner")}
                  </div>
                  <div className="mt-1 truncate text-sm">
                    {selectedItem.assigneeEmail || t("detail.unassigned")}
                  </div>
                </div>
                <div className="rounded-md border border-border p-3">
                  <div className="text-xs font-medium text-muted-foreground">
                    {t("detail.slaDue")}
                  </div>
                  <div className="mt-1 text-sm">
                    <RiskSignal item={selectedItem} /> ·{" "}
                    {formatRelative(selectedItem.dueAt)}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedItem.tags.length ? (
                  selectedItem.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      <IconTag className="size-3" />
                      {tag}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {t("detail.noTags")}
                  </span>
                )}
              </div>
            </div>
          )}
        </main>
        <aside className="overflow-visible bg-muted/25 p-4 lg:col-start-2 lg:min-h-0 lg:overflow-auto 2xl:col-start-auto">
          {!selectedItem ? (
            <div className="text-sm text-muted-foreground">
              {t("empty.sourceContext")}
            </div>
          ) : (
            <div className="space-y-5">
              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">
                    {t("source.heading")}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {t("source.description")}
                  </p>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">
                      {t("source.system")}
                    </span>
                    <span className="truncate font-medium">
                      {selectedItem.provider}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">
                      {t("source.displayId")}
                    </span>
                    <span className="truncate font-mono text-xs">
                      {selectedItem.sourceId}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">
                      {t("source.snapshotHash")}
                    </span>
                    <span className="truncate font-mono text-xs">
                      {selectedItem.lastSnapshotHash ??
                        t("source.snapshotHashNone")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">
                      {t("source.sourceUpdated")}
                    </span>
                    <span>{formatRelative(selectedItem.sourceUpdatedAt)}</span>
                  </div>
                </div>
                <SourceLink url={selectedItem.sourceUrl} />
              </section>
              <Separator />
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">
                  {t("snapshots.heading")}
                </h3>
                {selectedItem.recentSnapshots.length ? (
                  <div className="space-y-2">
                    {selectedItem.recentSnapshots
                      .slice(0, 5)
                      .map((snapshot) => (
                        <div
                          key={snapshot.id}
                          className="rounded-md border border-border bg-background p-2 text-xs"
                        >
                          <div className="flex items-center gap-2 font-mono">
                            <IconHash className="size-3.5 text-muted-foreground" />
                            <span className="truncate">
                              {snapshot.snapshotHash}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between text-muted-foreground">
                            <span>{formatRelative(snapshot.capturedAt)}</span>
                            <span>
                              {snapshot.changed
                                ? t("snapshots.changed")
                                : t("snapshots.unchanged")}
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("snapshots.empty")}
                  </p>
                )}
              </section>
              <Separator />
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">
                  {t("routing.heading")}
                </h3>
                {selectedItem.routingSuggestions.length ? (
                  <div className="space-y-2">
                    {selectedItem.routingSuggestions.map((suggestion) => (
                      <div
                        key={suggestion.id}
                        className="rounded-md border border-border bg-background p-2 text-xs"
                      >
                        <div className="font-medium">
                          {suggestion.suggestedAssigneeEmail ||
                            suggestion.suggestedTeamId ||
                            t("routing.noTarget")}
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {suggestion.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("routing.empty")}
                  </p>
                )}
              </section>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/queue")}
                className="w-full"
              >
                {t("routing.back")}
                <IconArrowRight />
              </Button>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
