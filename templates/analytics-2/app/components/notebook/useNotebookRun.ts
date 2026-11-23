import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  notifyRunFinished,
  useDesktopNotificationsEnabled,
} from "@/lib/desktop-notifications";
import type { CellOutput } from "@/lib/model/contracts";

import type controlNotebookKernel from "../../../actions/control-notebook-kernel";
import type getNotebookCellExecution from "../../../actions/get-notebook-cell-execution";
import type getNotebookExecution from "../../../actions/get-notebook-execution";
import type getNotebookKernelSession from "../../../actions/get-notebook-kernel-session";
import type getNotebookRun from "../../../actions/get-notebook-run";
import type setNotebookRunSettings from "../../../actions/set-notebook-run-settings";
import {
  runRequestSchema,
  type CellRunReceipt,
  type RunAdmission,
  type RunCancellation,
  type RunReceipt,
  type RunRequest,
} from "../../../shared/notebook-execution";
import type { CellRunMode, CellRunOptions } from "./NotebookRunControls";
import { useBrowserNotebookRun } from "./useBrowserNotebookRun";
import { waitUntilOnline } from "./wait-until-online";

type ExecutionRead = Awaited<ReturnType<typeof getNotebookExecution.run>>;
type RunRead = Awaited<ReturnType<typeof getNotebookRun.run>>;
type DraftExecution = Extract<ExecutionRead, { status: "found" }>;
type RunSettings = Pick<DraftExecution, "autoRerun" | "defaultMode">;
type KernelRead = Awaited<ReturnType<typeof getNotebookKernelSession.run>>;
type KernelControl = Awaited<ReturnType<typeof controlNotebookKernel.run>>;
type FoundKernel = Extract<KernelRead, { status: "found" }>;
export type NotebookCellExecutionRead = Awaited<
  ReturnType<typeof getNotebookCellExecution.run>
>;
type FoundCell = Extract<NotebookCellExecutionRead, { status: "found" }>;
export type PythonOutput =
  | FoundCell["outputs"][number]
  | {
      kind: "browser-table";
      table: Extract<CellOutput, { type: "table" }>;
    };
export type PythonExport = FoundCell["exports"][number];
export type KernelVariable = FoundKernel["variables"][number];

export type NotebookRunIntent =
  | { cellId: string; mode?: CellRunMode; options?: CellRunOptions }
  | { sectionId: string }
  | { all: true; restart?: boolean; bypassCache?: boolean };

type Admission =
  | RunRequest
  | {
      request: RunRequest;
      selection: NonNullable<CellRunOptions["selection"]>;
    };

const RUN_REFRESH_MS = 750;

function isDraftExecution(
  result: ExecutionRead | undefined,
): result is DraftExecution {
  return result?.status === "found";
}

function isActive(receipt: CellRunReceipt) {
  return (
    receipt.state.status === "queued" || receipt.state.status === "running"
  );
}

type ObservedRun = {
  run: RunReceipt;
  after: string;
};

async function readRun(
  runId: string,
  previous: ObservedRun | undefined,
  signal: AbortSignal,
): Promise<ObservedRun | null> {
  let after = previous?.after ?? "0";
  let current = previous?.run;
  for (;;) {
    const result = await callAction<RunRead>(
      "get-notebook-run",
      { runId, after, first: 100 },
      { method: "GET", signal },
    );
    if (result.status === "absent" || result.status === "denied") return null;
    if (result.status !== "found") throw new Error(result.reason);
    const attempts = new Map(
      (current ?? result.run).attempts.map((receipt) => [
        receipt.attempt.cellId,
        receipt,
      ]),
    );
    for (const { event } of result.events) {
      if (event.type === "attempt")
        attempts.set(event.receipt.attempt.cellId, event.receipt);
    }
    current = { ...result.run, attempts: [...attempts.values()] };
    if (result.events.length < 100)
      return { run: current, after: result.nextCursor };
    after = result.nextCursor;
  }
}

export function useNotebookRun({
  projectId,
  identity,
  enabled,
  workspaceId,
  workingVersionId,
  hasKernelCells,
}: {
  projectId: string;
  identity: string;
  enabled: boolean;
  workspaceId: string | undefined;
  workingVersionId: string | undefined;
  hasKernelCells: () => boolean;
}) {
  const t = useT();
  const client = useQueryClient();
  const desktopNotifications = useDesktopNotificationsEnabled();
  const notified = useRef<string | null>(null);
  const [local, setLocal] = useState<{
    identity: string;
    runId: RunReceipt["runId"] | null;
    snippetId: string | null;
    pending: boolean;
    restarting: boolean;
    stopping: boolean;
  }>({
    identity,
    runId: null,
    snippetId: null,
    pending: false,
    restarting: false,
    stopping: false,
  });
  const current = local.identity === identity ? local : undefined;
  const scope = useRef<{ identity: string } | undefined>(undefined);
  if (!enabled) scope.current = undefined;
  else if (scope.current?.identity !== identity) scope.current = { identity };
  useEffect(() => {
    if (enabled) scope.current ??= { identity };
    const observed = scope.current;
    return () => {
      if (scope.current === observed) scope.current = undefined;
    };
  }, [enabled, identity]);
  const admissionLock = useRef<{ identity: string } | null>(null);
  const cancellationLock = useRef<{ identity: string } | null>(null);
  const update = useCallback(
    (patch: Partial<Omit<typeof local, "identity">>) => {
      if (scope.current?.identity !== identity) return;
      setLocal((previous) => ({
        ...(previous.identity === identity
          ? previous
          : {
              identity,
              runId: null,
              snippetId: null,
              pending: false,
              restarting: false,
              stopping: false,
            }),
        ...patch,
      }));
    },
    [identity],
  );

  const matchesDraft = useCallback(
    (data: DraftExecution) =>
      data.snapshot.namespace.kind === "draft" &&
      data.snapshot.ref.projectId === projectId &&
      data.snapshot.ref.workspaceId === workspaceId &&
      data.snapshot.ref.head.versionId === workingVersionId,
    [projectId, workspaceId, workingVersionId],
  );

  const observeAdmission = useCallback(
    (receipt: RunReceipt, selection?: boolean) => {
      if (scope.current?.identity !== identity) return;
      const key = ["notebook-run", identity, receipt.runId];
      client.setQueryData<ObservedRun>(
        key,
        (previous) => previous ?? { run: receipt, after: receipt.cursor },
      );
      update({
        runId: receipt.runId,
        ...(selection ? { snippetId: receipt.runId } : {}),
      });
    },
    [client, identity, update],
  );

  const read = useActionQuery<ExecutionRead>(
    "get-notebook-execution",
    { projectId },
    {
      enabled,
      queryKeyScope: [identity],
      refetchInterval: (query) => {
        const data = query.state.data;
        return data?.status === "found" &&
          (data.activeRunIds.length > 0 || data.reactivePending)
          ? RUN_REFRESH_MS
          : false;
      },
    },
  );
  const execution =
    enabled &&
    !read.isError &&
    isDraftExecution(read.data) &&
    matchesDraft(read.data)
      ? read.data
      : undefined;
  const browser = useBrowserNotebookRun(identity, execution);
  const kernel = useActionQuery<KernelRead>(
    "get-notebook-kernel-session",
    { scope: { kind: "draft", projectId } },
    {
      enabled,
      queryKeyScope: [identity],
      refetchInterval:
        execution && execution.activeRunIds.length > 0 ? RUN_REFRESH_MS : false,
    },
  );
  const kernelRead = kernel.data;
  const session: FoundKernel | null =
    enabled && !kernel.isError && kernelRead && "variables" in kernelRead
      ? kernelRead
      : null;
  const runIds = enabled
    ? [
        ...new Set([
          ...(execution?.activeRunIds ?? []),
          ...(current?.runId ? [current.runId] : []),
          ...(current?.snippetId ? [current.snippetId] : []),
        ]),
      ]
    : [];
  const observed = useQueries({
    queries: runIds.map((id) => {
      const key = ["notebook-run", identity, id];
      return {
        queryKey: key,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          readRun(
            id,
            client.getQueryData<ObservedRun | null>(key) ?? undefined,
            signal,
          ),
        refetchInterval: (query: {
          state: { data: ObservedRun | null | undefined };
        }) =>
          query.state.data === undefined ||
          query.state.data?.run.attempts.some(isActive)
            ? RUN_REFRESH_MS
            : false,
      };
    }),
  });

  const runs = observed.flatMap(({ data }) => (data ? [data.run] : []));
  runs.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const active = runs.filter((run) => run.attempts.some(isActive));
  const run = active.at(-1) ?? runs.at(-1) ?? null;
  const runningIds = new Set([
    ...browser.active,
    ...active.flatMap((run) =>
      run.attempts
        .filter(isActive)
        .map((receipt) => String(receipt.attempt.cellId)),
    ),
  ]);
  const submitted = runs.find((receipt) => receipt.runId === current?.runId);
  const finishedManualId =
    submitted &&
    submitted.request.mode !== "run-all" &&
    !submitted.attempts.some(isActive) &&
    submitted.attempts.length > 0
      ? submitted.runId
      : undefined;
  useEffect(() => {
    if (finishedManualId === undefined || notified.current === finishedManualId)
      return;
    notified.current = finishedManualId;
    notifyRunFinished({
      enabled: desktopNotifications,
      title: t("notebook.runFinishedNotification"),
      body: t("notebook.runFinishedNotificationBody"),
    });
  }, [desktopNotifications, finishedManualId, t]);
  const snippetRun = runs.find((run) => run.runId === current?.snippetId);
  const snippetAttempt = snippetRun?.attempts[0];

  const refresh = read.refetch;
  const refreshObserved = useCallback(async () => {
    await client.invalidateQueries({ queryKey: ["notebook-run", identity] });
    return refresh();
  }, [client, identity, refresh]);
  const terminalKey = runs
    .filter((run) => !run.attempts.some(isActive))
    .map((run) => run.runId)
    .join(",");
  useEffect(() => {
    if (!terminalKey) return;
    void refresh();
    void client.invalidateQueries({
      queryKey: [
        "action",
        "get-notebook-kernel-session",
        { scope: { kind: "draft", projectId } },
        identity,
      ],
    });
    void client.invalidateQueries({
      queryKey: ["action", "get-notebook-input-choices"],
    });
    void client.invalidateQueries({
      queryKey: ["action", "get-workspace-activity"],
    });
  }, [client, identity, projectId, refresh, terminalKey]);

  const restartKernel = useCallback(
    async (operation: "restart" | "restart-and-run-all") => {
      const observedScope = scope.current;
      if (observedScope?.identity !== identity) return null;
      const input = { scope: { kind: "draft" as const, projectId } };
      const latest = await callAction<KernelRead>(
        "get-notebook-kernel-session",
        input,
        { method: "GET" },
      );
      if (scope.current !== observedScope) return null;
      if (latest.status !== "found")
        throw new Error(t("notebook.runFailedExecution"));
      const result = await callAction<KernelControl>(
        "control-notebook-kernel",
        {
          ...input,
          operation,
          expectedGeneration: latest.generation,
          requestId: crypto.randomUUID(),
        },
        { uiOnly: true, keepalive: false },
      );
      if (scope.current !== observedScope) return null;
      if ("status" in result) throw new Error(t("notebook.runFailedExecution"));
      update({ snippetId: null, runId: result.runId ?? null });
      await Promise.all([
        refresh(),
        client.invalidateQueries({
          queryKey: ["action", "get-notebook-kernel-session", input, identity],
        }),
      ]);
      if (scope.current !== observedScope) return null;
      if (result.state === "unknown")
        throw new Error(t("notebook.runFailedExecution"));
      return result;
    },
    [client, identity, projectId, refresh, t, update],
  );

  const start = useCallback(
    async (intent: NotebookRunIntent) => {
      const observedScope = scope.current;
      if (!enabled || observedScope?.identity !== identity) return false;
      if (admissionLock.current === observedScope) return false;
      admissionLock.current = observedScope;
      update({ pending: true });
      try {
        await waitUntilOnline();
        if (scope.current !== observedScope) return false;
        if (
          "all" in intent &&
          intent.restart &&
          hasKernelCells() &&
          !browser.enabled
        ) {
          update({ restarting: true });
          const result = await restartKernel("restart-and-run-all");
          return result !== null;
        }
        const accepted = await callAction<ExecutionRead>(
          "get-notebook-execution",
          { projectId },
          { method: "GET" },
        );
        if (scope.current !== observedScope) return false;
        if (accepted.status === "found" && !matchesDraft(accepted))
          throw new Error(t("queryError.interrupted"));
        if (accepted.status !== "found") throw new Error(t("queryError.title"));
        const selection =
          "cellId" in intent ? intent.options?.selection : undefined;
        const targetCellId =
          "sectionId" in intent
            ? intent.sectionId
            : "cellId" in intent
              ? intent.cellId
              : undefined;
        const request = runRequestSchema.parse({
          requestId: crypto.randomUUID(),
          snapshot: accepted.snapshot,
          cache: (
            "all" in intent
              ? intent.bypassCache
              : "cellId" in intent && intent.options?.bypassCache
          )
            ? "bypass"
            : "reuse",
          ...("all" in intent
            ? { mode: "run-all", restart: intent.restart ?? false }
            : {
                mode:
                  "sectionId" in intent
                    ? "run-section"
                    : selection
                      ? "cell-only"
                      : (intent.mode ?? accepted.defaultMode),
                targetCellId,
                staleValues: "allow-compatible",
              }),
        });
        if (!selection) {
          const localResult = await browser.start(accepted, request);
          if (localResult !== null) {
            if (scope.current === observedScope) {
              const [latest] = await Promise.all([
                refresh(),
                client.invalidateQueries({
                  queryKey: [
                    "action",
                    "get-notebook-kernel-session",
                    { scope: { kind: "draft", projectId } },
                  ],
                }),
                client.invalidateQueries({
                  queryKey: ["action", "get-notebook-transform", { projectId }],
                }),
                client.invalidateQueries({
                  queryKey: [
                    "action",
                    "get-notebook-visualization-page",
                    { projectId },
                  ],
                }),
                client.invalidateQueries({
                  queryKey: [
                    "action",
                    "get-notebook-input-choices",
                    { projectId },
                  ],
                }),
              ]);
              if (
                scope.current === observedScope &&
                !latest.isError &&
                isDraftExecution(latest.data) &&
                matchesDraft(latest.data)
              )
                browser.observeServerReadback();
            }
            return scope.current === observedScope && localResult;
          }
        }
        const payload: Admission = selection ? { request, selection } : request;
        const submit = () =>
          callAction<RunAdmission>("start-notebook-run", payload, {
            uiOnly: true,
            keepalive: false,
          });
        let result: RunAdmission;
        try {
          result = await submit();
        } catch {
          if (scope.current !== observedScope) return false;
          result = await submit();
        }
        if (scope.current !== observedScope) return false;
        if (result.status !== "admitted") {
          if (
            result.status === "rejected" &&
            result.reason === "stale_snapshot"
          )
            throw new Error(t("queryError.interrupted"));
          throw new Error(t("queryError.title"));
        }
        observeAdmission(result, selection !== undefined);
        await refresh();
        if (scope.current !== observedScope) return false;
        if (targetCellId) {
          const reason = result.plan.rejectedCells.find(
            ({ cellId }) => cellId === targetCellId,
          )?.reason;
          if (reason)
            throw new Error(
              t(
                reason === "missing_prerequisite"
                  ? "notebook.runMissingPrerequisite"
                  : reason === "incompatible_prerequisite"
                    ? "notebook.runIncompatiblePrerequisite"
                    : "notebook.runFailedExecution",
              ),
            );
        }
        return true;
      } finally {
        if (admissionLock.current === observedScope) {
          admissionLock.current = null;
          if (scope.current === observedScope)
            update({ pending: false, restarting: false });
        }
      }
    },
    [
      browser,
      client,
      enabled,
      hasKernelCells,
      identity,
      matchesDraft,
      observeAdmission,
      projectId,
      refresh,
      restartKernel,
      t,
      update,
    ],
  );

  const restart = async () => {
    if (browser.enabled) return browser.restart();
    const observedScope = scope.current;
    if (observedScope?.identity !== identity) return;
    if (admissionLock.current === observedScope) return;
    admissionLock.current = observedScope;
    update({ restarting: true });
    try {
      await restartKernel("restart");
    } finally {
      if (admissionLock.current === observedScope) {
        admissionLock.current = null;
        if (scope.current === observedScope) update({ restarting: false });
      }
    }
  };

  const cancel = async (cellId?: string) => {
    if (browser.active.size && (!cellId || browser.active.has(cellId)))
      return browser.cancel();
    const observedScope = scope.current;
    if (observedScope?.identity !== identity) return;
    const toCancel = cellId
      ? active.filter((run) =>
          run.attempts.some(
            (receipt) => receipt.attempt.cellId === cellId && isActive(receipt),
          ),
        )
      : active;
    if (!toCancel.length || cancellationLock.current === observedScope) return;
    cancellationLock.current = observedScope;
    update({ stopping: true });
    try {
      const outcomes = await Promise.all(
        toCancel.map(({ runId }) =>
          callAction<RunCancellation>(
            "cancel-notebook-run",
            {
              runId,
              ...(cellId ? { cellId } : {}),
            },
            { uiOnly: true, keepalive: false },
          ),
        ),
      );
      if (scope.current !== observedScope) return;
      if (outcomes.some((result) => result.status === "unknown"))
        toast.error(t("queryError.cancelUnknown"));
      else if (outcomes.some((result) => result.status === "completed"))
        toast.info(t("notebook.runCompletionWon"));
      else if (
        outcomes.some(
          (result) =>
            result.status !== "cancelled" && result.status !== "pending",
        )
      )
        toast.error(t("queryError.cancelFailed"));
    } catch {
      if (scope.current === observedScope)
        toast.error(t("queryError.cancelFailed"));
    } finally {
      try {
        if (scope.current === observedScope) await refreshObserved();
      } finally {
        if (cancellationLock.current === observedScope) {
          cancellationLock.current = null;
          if (scope.current === observedScope) update({ stopping: false });
        }
      }
    }
  };

  const clearSelection = useCallback(
    () => update({ snippetId: null }),
    [update],
  );

  const setSettings = async (settings: Partial<RunSettings>) => {
    if (!execution) return;
    try {
      const result = await callAction<
        Awaited<ReturnType<typeof setNotebookRunSettings.run>>
      >(
        "set-notebook-run-settings",
        {
          projectId,
          expectedSettingsRevision: execution.settingsRevision,
          ...settings,
        },
        { uiOnly: true, keepalive: false },
      );
      if (result.status !== "saved") toast.error(t("notebook.saveFailed"));
    } catch {
      toast.error(t("notebook.saveFailed"));
    } finally {
      await refresh();
    }
  };

  return {
    ready: execution != null,
    cells: execution?.cells,
    defaultMode: execution?.defaultMode ?? ("auto" as const),
    autoRerun: execution?.autoRerun ?? true,
    run,
    runningIds,
    ...(browser.enabled ? { browser } : {}),
    pending:
      scope.current !== undefined &&
      admissionLock.current === scope.current &&
      current?.pending === true &&
      browser.active.size === 0,
    stopping:
      scope.current !== undefined &&
      cancellationLock.current === scope.current &&
      current?.stopping === true,
    restarting:
      browser.phase === "starting" ||
      (scope.current !== undefined &&
        admissionLock.current === scope.current &&
        current?.restarting === true),
    session,
    snippetAttempt,
    start,
    observeAdmission,
    cancel,
    restart,
    clearSelection,
    refresh: refreshObserved,
    refreshSnapshot: refresh,
    setSettings,
  };
}

export type NotebookRunController = ReturnType<typeof useNotebookRun>;
