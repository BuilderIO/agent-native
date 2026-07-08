/**
 * Uptime monitoring panel — OWNED BY THE UPTIME MONITORING FEATURE.
 *
 * Renders the monitor list + detail below the Monitoring tab bar. Selection is
 * reflected in the `?monitor=<id>` query param (shareable + agent-deep-linkable)
 * and mirrored into `application_state` so the agent knows what the user views.
 * Data flows through the monitor actions; `useChangeVersions(["monitors"])`
 * keeps the UI fresh as background sweeps and agent edits land.
 */
import {
  setClientAppState,
  useActionMutation,
  useActionQuery,
  useChangeVersions,
} from "@agent-native/core/client";
import { IconPlus, IconRefresh, IconSearch } from "@tabler/icons-react";
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
import { MonitorFormDialog } from "./uptime/MonitorFormDialog";
import { MonitorList } from "./uptime/MonitorList";
import type {
  CheckOutcome,
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
  const selectedId = searchParams.get("monitor");

  const [search, setSearch] = useState("");
  const [dialogMonitor, setDialogMonitor] = useState<MonitorSummary | null>(
    null,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
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

  // Refresh list + detail when a background sweep or agent edit records a
  // "monitors" change (useDbSync bumps the version this hook reads).
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["action", "list-monitors"] });
    queryClient.invalidateQueries({ queryKey: ["action", "get-monitor"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync]);

  const selectedMonitor = useMemo(
    () => monitors.find((m) => m.id === selectedId) ?? null,
    [monitors, selectedId],
  );

  // Mirror the current selection into application_state for the agent.
  useEffect(() => {
    const value = selectedMonitor
      ? {
          view: "uptime",
          monitorId: selectedMonitor.id,
          monitorName: selectedMonitor.name,
          url: selectedMonitor.url,
          status: selectedMonitor.lastStatus,
        }
      : selectedId
        ? { view: "uptime", monitorId: selectedId }
        : { view: "uptime" };
    void setClientAppState("monitoring", value).catch(() => {});
  }, [selectedMonitor, selectedId]);

  const selectMonitor = (id: string | null) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (id) params.set("monitor", id);
        else params.delete("monitor");
        return params;
      },
      { replace: false },
    );
  };

  const openCreate = () => {
    setDialogMonitor(null);
    setDialogOpen(true);
  };

  const openEdit = (monitor: MonitorSummary) => {
    setDialogMonitor(monitor);
    setDialogOpen(true);
  };

  const handleSubmit = async (input: SaveMonitorInput) => {
    try {
      const saved = await saveMonitor.mutateAsync(input);
      setDialogOpen(false);
      toast.success(t.saved);
      if (!input.id && saved?.id) selectMonitor(saved.id);
    } catch (err) {
      toast.error(
        fmt(t.saveFailed, {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
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
    if (selectedId === target.id) selectMonitor(null);
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
  };

  // Detail view
  if (selectedId) {
    return (
      <>
        <MonitorDetail
          monitorId={selectedId}
          fallback={selectedMonitor ?? undefined}
          onBack={() => selectMonitor(null)}
          onEdit={openEdit}
          onDelete={setMonitorToDelete}
          onRunCheck={handleRunCheck}
          running={runningId === selectedId}
        />
        <MonitorFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          monitor={dialogMonitor}
          onSubmit={handleSubmit}
          saving={saveMonitor.isPending}
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
            <Button size="sm" onClick={openCreate}>
              <IconPlus className="size-3.5" />
              {t.addMonitor}
            </Button>
          </div>
        </div>

        <MonitorList
          monitors={filtered}
          isLoading={isLoading}
          hasSearch={search.trim().length > 0}
          runningId={runningId}
          onSelect={(m) => selectMonitor(m.id)}
          onToggle={handleToggle}
          onRunCheck={handleRunCheck}
          onCreate={openCreate}
        />
      </div>

      <MonitorFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        monitor={dialogMonitor}
        onSubmit={handleSubmit}
        saving={saveMonitor.isPending}
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
