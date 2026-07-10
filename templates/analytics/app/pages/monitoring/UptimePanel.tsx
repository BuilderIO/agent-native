/**
 * Uptime monitoring panel — OWNED BY THE UPTIME MONITORING FEATURE.
 *
 * Swaps between three query-param-driven views (all under the Monitoring tab):
 *   - list:   ?view=uptime
 *   - detail: ?view=uptime&monitor=<id>
 *   - create: ?view=uptime&monitor=new
 *   - edit:   ?view=uptime&monitor=<id>&edit=1
 * Everything is deep-linkable + back-button friendly and mirrored into
 * `application_state` so the agent knows what the user views. Data flows through
 * the monitor actions; `useChangeVersions(["monitors"])` keeps the UI fresh as
 * background sweeps and agent edits land.
 */
import {
  setClientAppState,
  useActionMutation,
  useActionQuery,
  useChangeVersions,
} from "@agent-native/core/client";
import {
  IconLink,
  IconPlus,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { fmt, useUptimeT } from "./uptime/i18n";
import { MonitorDetail } from "./uptime/MonitorDetail";
import { MonitorFormPage } from "./uptime/MonitorFormPage";
import { MonitorList } from "./uptime/MonitorList";
import { StatusPagesView } from "./uptime/status-pages/StatusPagesView";
import type {
  CheckOutcome,
  MonitorStats,
  MonitorSummary,
  SaveMonitorInput,
} from "./uptime/types";
import { hostFromUrl, statusLabel } from "./uptime/utils";

const LIST_KEY = ["action", "list-monitors", undefined];

function payloadFromMonitor(
  monitor: MonitorSummary,
  overrides: Partial<SaveMonitorInput> = {},
): SaveMonitorInput {
  return {
    id: monitor.id,
    name: monitor.name,
    url: monitor.url,
    method: monitor.method,
    requestHeaders: monitor.requestHeaders,
    requestBody: monitor.requestBody,
    intervalSeconds: monitor.intervalSeconds,
    timeoutMs: monitor.timeoutMs,
    expectedStatus: monitor.expectedStatus,
    assertions: monitor.assertions,
    followRedirects: monitor.followRedirects,
    severity: monitor.severity,
    channels: monitor.channels,
    emailRecipients: monitor.emailRecipients,
    cooldownMinutes: monitor.cooldownMinutes,
    enabled: monitor.enabled,
    ...overrides,
  };
}

export function UptimePanel() {
  const t = useUptimeT();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const monitorParam = searchParams.get("monitor");
  const statusPageParam = searchParams.get("statuspage");
  const isCreate = monitorParam === "new";
  const selectedId = isCreate ? null : monitorParam;
  const isEditing = !!selectedId && searchParams.get("edit") === "1";

  const [search, setSearch] = useState("");
  const [monitorToDelete, setMonitorToDelete] = useState<MonitorSummary | null>(
    null,
  );
  const [runningId, setRunningId] = useState<string | null>(null);

  const sync = useChangeVersions(["monitors", "action"]);

  const { data, isLoading } = useActionQuery<MonitorSummary[]>(
    "list-monitors",
    undefined,
    { staleTime: 10_000 },
  );

  // Aggregate stats for the whole list (status/uptime windows + 90-day timeline)
  // power the list's per-row uptime bars and the "current status" overview.
  const { data: statsList } = useActionQuery<MonitorStats[]>(
    "get-monitor-stats",
    { timelineDays: 90 },
    { staleTime: 30_000 },
  );

  const saveMonitor = useActionMutation<MonitorSummary, SaveMonitorInput>(
    "save-monitor",
  );
  const deleteMonitor = useActionMutation<
    { ok: boolean; id: string },
    { id: string }
  >("delete-monitor");
  const runCheck = useActionMutation<CheckOutcome, { id: string }>(
    "run-monitor-check",
  );

  const monitors = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const statsById = useMemo(() => {
    const map = new Map<string, MonitorStats>();
    for (const stat of statsList ?? []) map.set(stat.monitorId, stat);
    return map;
  }, [statsList]);

  // Refresh list + detail when a background sweep or agent edit records a
  // "monitors" change (useDbSync bumps the version this hook reads).
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["action", "list-monitors"] });
    queryClient.invalidateQueries({ queryKey: ["action", "get-monitor"] });
    queryClient.invalidateQueries({
      queryKey: ["action", "get-monitor-stats"],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync]);

  const selectedMonitor = useMemo(
    () => monitors.find((m) => m.id === selectedId) ?? null,
    [monitors, selectedId],
  );

  // Mirror the current selection / form mode into application_state.
  useEffect(() => {
    if (statusPageParam !== null) {
      const spMode =
        statusPageParam === "list"
          ? "status-pages"
          : statusPageParam === "new"
            ? "status-page-create"
            : "status-page-edit";
      void setClientAppState("monitoring", {
        view: "uptime",
        mode: spMode,
        ...(statusPageParam !== "list" && statusPageParam !== "new"
          ? { statusPageId: statusPageParam }
          : {}),
      }).catch(() => {});
      return;
    }
    const mode = isCreate ? "create" : isEditing ? "edit" : "view";
    const value = selectedMonitor
      ? {
          view: "uptime",
          mode,
          monitorId: selectedMonitor.id,
          monitorName: selectedMonitor.name,
          url: selectedMonitor.url,
          status: selectedMonitor.lastStatus,
        }
      : selectedId
        ? { view: "uptime", mode, monitorId: selectedId }
        : { view: "uptime", mode };
    void setClientAppState("monitoring", value).catch(() => {});
  }, [selectedMonitor, selectedId, isCreate, isEditing, statusPageParam]);

  const updateParams = (
    mutate: (params: URLSearchParams) => void,
    options?: { replace?: boolean },
  ) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        mutate(params);
        return params;
      },
      { replace: options?.replace ?? false },
    );
  };

  const showList = () =>
    updateParams((params) => {
      params.delete("monitor");
      params.delete("edit");
    });

  const showDetail = (id: string, options?: { replace?: boolean }) =>
    updateParams((params) => {
      params.set("monitor", id);
      params.delete("edit");
    }, options);

  const openCreate = () =>
    updateParams((params) => {
      params.set("monitor", "new");
      params.delete("edit");
    });

  const openEdit = (monitor: MonitorSummary) =>
    updateParams((params) => {
      params.set("monitor", monitor.id);
      params.set("edit", "1");
    });

  const openStatusPages = () =>
    updateParams((params) => {
      params.set("statuspage", "list");
      params.delete("monitor");
      params.delete("edit");
    });

  const handleSaved = (saved: MonitorSummary) => {
    // Replace the form entry with the monitor's detail so Back skips the form.
    showDetail(saved.id, { replace: true });
  };

  const handleFormCancel = () => {
    if (selectedId) showDetail(selectedId, { replace: true });
    else showList();
  };

  const handleToggle = async (monitor: MonitorSummary, enabled: boolean) => {
    const previous =
      queryClient.getQueryData<MonitorSummary[]>(LIST_KEY) ?? monitors;
    queryClient.setQueryData<MonitorSummary[]>(LIST_KEY, (old) =>
      (old ?? []).map((m) => (m.id === monitor.id ? { ...m, enabled } : m)),
    );
    try {
      await saveMonitor.mutateAsync(payloadFromMonitor(monitor, { enabled }));
      toast.success(enabled ? t.enabledToast : t.disabledToast);
    } catch (err) {
      queryClient.setQueryData<MonitorSummary[]>(LIST_KEY, previous);
      toast.error(
        fmt(t.saveFailed, {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  };

  const handleRunCheck = async (monitor: MonitorSummary) => {
    setRunningId(monitor.id);
    queryClient.setQueryData<MonitorSummary[]>(LIST_KEY, (old) =>
      (old ?? []).map((m) =>
        m.id === monitor.id ? { ...m, lastStatus: "running" } : m,
      ),
    );
    try {
      const outcome = await runCheck.mutateAsync({ id: monitor.id });
      if (outcome.ok) {
        toast.success(
          fmt(t.checkOk, {
            name: monitor.name,
            latency: outcome.latencyMs ?? 0,
          }),
        );
      } else {
        toast.error(
          fmt(t.checkDown, {
            name: monitor.name,
            status: statusLabel(outcome.status, t).toLowerCase(),
          }),
        );
      }
    } catch (err) {
      toast.error(
        fmt(t.checkFailed, {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setRunningId(null);
    }
  };

  const handleDelete = async () => {
    if (!monitorToDelete) return;
    const target = monitorToDelete;
    setMonitorToDelete(null);
    const previous =
      queryClient.getQueryData<MonitorSummary[]>(LIST_KEY) ?? monitors;
    queryClient.setQueryData<MonitorSummary[]>(LIST_KEY, (old) =>
      (old ?? []).filter((m) => m.id !== target.id),
    );
    if (selectedId === target.id) showList();
    try {
      await deleteMonitor.mutateAsync({ id: target.id });
      toast.success(t.deleted);
    } catch (err) {
      queryClient.setQueryData<MonitorSummary[]>(LIST_KEY, previous);
      toast.error(
        fmt(t.deleteFailed, {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["action", "list-monitors"] });
    queryClient.invalidateQueries({ queryKey: ["action", "get-monitor"] });
    queryClient.invalidateQueries({
      queryKey: ["action", "get-monitor-stats"],
    });
  };

  // Status pages — config sub-view (list / create / edit)
  if (statusPageParam !== null) {
    return <StatusPagesView />;
  }

  // Create / edit — full-page form
  if (isCreate || isEditing) {
    return (
      <>
        <MonitorFormPage
          monitorId={isCreate ? null : selectedId}
          initialMonitor={selectedMonitor}
          onCancel={handleFormCancel}
          onSaved={handleSaved}
        />
        <DeleteDialog
          monitor={monitorToDelete}
          onCancel={() => setMonitorToDelete(null)}
          onConfirm={handleDelete}
          pending={deleteMonitor.isPending}
        />
      </>
    );
  }

  // Detail view
  if (selectedId) {
    return (
      <>
        <MonitorDetail
          monitorId={selectedId}
          fallback={selectedMonitor ?? undefined}
          onBack={showList}
          onEdit={openEdit}
          onDelete={setMonitorToDelete}
          onRunCheck={handleRunCheck}
          running={runningId === selectedId}
        />
        <DeleteDialog
          monitor={monitorToDelete}
          onCancel={() => setMonitorToDelete(null)}
          onConfirm={handleDelete}
          pending={deleteMonitor.isPending}
        />
      </>
    );
  }

  const filtered = search.trim()
    ? monitors.filter((m) => {
        const q = search.toLowerCase();
        return (
          m.name.toLowerCase().includes(q) ||
          m.url.toLowerCase().includes(q) ||
          hostFromUrl(m.url).toLowerCase().includes(q)
        );
      })
    : monitors;

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative sm:w-72">
            <IconSearch className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="ps-8"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              aria-label={t.refresh}
            >
              <IconRefresh className="size-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={openStatusPages}>
              <IconLink className="size-3.5" />
              {t.statusPagesButton}
            </Button>
            <Button size="sm" onClick={openCreate}>
              <IconPlus className="size-3.5" />
              {t.addMonitor}
            </Button>
          </div>
        </div>

        <MonitorList
          monitors={filtered}
          statsById={statsById}
          isLoading={isLoading}
          hasSearch={search.trim().length > 0}
          runningId={runningId}
          onSelect={(m) => showDetail(m.id)}
          onToggle={handleToggle}
          onRunCheck={handleRunCheck}
          onCreate={openCreate}
        />
      </div>

      <DeleteDialog
        monitor={monitorToDelete}
        onCancel={() => setMonitorToDelete(null)}
        onConfirm={handleDelete}
        pending={deleteMonitor.isPending}
      />
    </>
  );
}

function DeleteDialog({
  monitor,
  onCancel,
  onConfirm,
  pending,
}: {
  monitor: MonitorSummary | null;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const t = useUptimeT();
  return (
    <AlertDialog open={!!monitor} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.deleteTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {fmt(t.deleteDescription, { name: monitor?.name ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t.deleteConfirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
