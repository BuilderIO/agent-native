import {
  sendToAgentChat,
  sendToAgentChatAndConfirm,
} from "@agent-native/core/client/agent-chat";
import {
  deleteClientAppState,
  useActionMutation,
  useActionQuery,
  writeClientAppState,
} from "@agent-native/core/client/hooks";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconSitemap,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useSearchParams } from "react-router";
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
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useEditorSnapshot,
  useWorkflowCanvasStrings,
  useWorkflowEditor,
  WorkflowCanvas,
} from "@/components/workflow-canvas";
import { ParkedCountsContext } from "@/components/workflow-canvas/parked-counts-context";
import { RunModeBadge } from "@/components/workflow-canvas/RunModeBadge";
import { useNewNodeHighlight } from "@/components/workflow-canvas/use-new-node-highlight";
import {
  isNodeDetailsOpen,
  leavesOpenWorkflow,
  NODE_DETAILS_OPEN,
  NODE_DETAILS_PARAM,
  readWorkflowParams,
} from "@/lib/factory-tab-params";
import { TAB_ID } from "@/lib/tab-id";
import type { WorkflowGraph } from "@/lib/workflow-editor";

import {
  missingConnections,
  unconnectedByNode,
} from "../factory/connection-rows";
import { useProviderConnections } from "../factory/use-provider-connections";
import { ConnectionsPopover } from "./ConnectionsPopover";
import { useCopyDiagnostics } from "./CopyDiagnostics";
import {
  newWorkflowAgentMessage,
  takeNewWorkflowRequest,
} from "./new-workflow";
import { NodeDetailsDialog } from "./node-details/NodeDetailsDialog";
import { RunPicker } from "./RunPicker";
import { useParkedCounts } from "./use-parked-counts";
import { WORKFLOW_CATALOG } from "./workflow-catalog";
import {
  buildAgentContext,
  buildEditorAppState,
  isGraphDirty,
  urlParamsForSelection,
  WORKFLOW_EDITOR_STATE_KEY,
} from "./workflow-editor-state";
import {
  classifySaveFailure,
  isUnknownActionError,
  readActionFailure,
  type ActionFailure,
  type ServerIssue,
} from "./workflow-errors";
import { RECENT_RUNS, withRenamedWorkflow } from "./workflow-list-model";
import { listProblems, type ProblemRow } from "./workflow-problems";
import { runOverlay } from "./workflow-run-overlay";
import { useWorkflowStrings } from "./workflow-strings";
import type {
  GetWorkflowResult,
  ListRunsResult,
  ListWorkflowsResult,
  RenameWorkflowResult,
  RestoreWorkflowResult,
  RunDetail,
  RunWorkflowMode,
  RunWorkflowResult,
  SaveWorkflowResult,
  SetEnabledResult,
} from "./workflow-types";
import { WorkflowToolbar } from "./WorkflowToolbar";
import { WorkflowVersionsPanel } from "./WorkflowVersionsPanel";

const RUN_WATCH_INTERVAL_MS = 1_500;
/** How long a queued run may go unstarted before the page stops holding the canvas for it: a cold scheduler can take a minute or more. */
const QUEUED_RUN_WAIT_MS = 120_000;
const STATE_WRITE_DELAY_MS = 400;
const MINIMAP_NODE_COUNT = 16;

interface WorkflowPageProps {
  factoryId: string;
  workflowId: string;
  /** The Workflows list, for the back arrow. */
  backHref: string;
}

/** Loads one workflow and mounts its editor, or says why it cannot. */
export function WorkflowPage({
  factoryId,
  workflowId,
  backHref,
}: WorkflowPageProps) {
  const ws = useWorkflowStrings();

  const query = useActionQuery<GetWorkflowResult>("get-factory-workflow", {
    factoryId,
    workflowId,
  });

  if (query.data) {
    return (
      <WorkflowEditorSurface
        key={workflowId}
        factoryId={factoryId}
        workflowId={workflowId}
        backHref={backHref}
        workflow={query.data}
        refetch={async () => (await query.refetch()).data}
      />
    );
  }
  if (query.isError) {
    const missing =
      readActionFailure(query.error, ws.errors.unknown).errorCode ===
      "workflow_not_found";
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <Empty className="m-auto">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {missing ? <IconSitemap /> : <IconAlertCircle />}
            </EmptyMedia>
            <EmptyTitle>
              {missing ? ws.page.notFound : ws.page.loadFailed}
            </EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            {missing ? null : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void query.refetch()}
              >
                {ws.page.retry}
              </Button>
            )}
            <Button asChild type="button" variant="ghost" size="sm">
              <Link to={backHref}>{ws.page.backToWorkflows}</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }
  return <WorkflowPageSkeleton backHref={backHref} />;
}

/** The toolbar and canvas area at their final size, so the page does not jump when the graph arrives. */
function WorkflowPageSkeleton({ backHref }: { backHref: string }) {
  const ws = useWorkflowStrings();

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      aria-busy
      aria-label={ws.page.canvasLoading}
    >
      <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button asChild variant="ghost" size="icon-sm">
          <Link to={backHref} aria-label={ws.page.backToWorkflows}>
            <IconArrowLeft />
          </Link>
        </Button>
        <Skeleton className="h-5 w-48" />
        <div className="ms-auto flex items-center gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <Skeleton className="absolute start-[12%] top-[34%] h-16 w-52" />
        <Skeleton className="absolute start-[34%] top-[34%] h-16 w-52" />
        <Skeleton className="absolute start-[56%] top-[22%] h-16 w-52" />
        <Skeleton className="absolute start-[56%] top-[48%] h-16 w-52" />
      </div>
    </div>
  );
}

interface Saved {
  graph: WorkflowGraph;
  /** The version the saved graph is. An unsaved graph is based on this one. */
  version: number;
}

function WorkflowEditorSurface({
  factoryId,
  workflowId,
  backHref,
  workflow,
  refetch,
}: WorkflowPageProps & {
  workflow: GetWorkflowResult;
  refetch: () => Promise<GetWorkflowResult | undefined>;
}) {
  const ws = useWorkflowStrings();
  const canvasStrings = useWorkflowCanvasStrings();

  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const nodeParam = searchParams.get("node");
  const edgeParam = searchParams.get("edge");
  const runParam = searchParams.get("run");
  const versionParam = readWorkflowParams(searchParams).version;

  const [graph, setGraph] = useState<WorkflowGraph>(workflow.graph);
  const [saved, setSaved] = useState<Saved>({
    graph: workflow.graph,
    version: workflow.version,
  });
  const [saving, setSaving] = useState(false);
  const [serverIssues, setServerIssues] = useState<ServerIssue[]>([]);
  const [problemsOpen, setProblemsOpen] = useState(false);
  // A link to a saved version opens the list with that version marked.
  const [versionsOpen, setVersionsOpen] = useState(versionParam !== null);
  const [conflict, setConflict] = useState<{ latest: number | null } | null>(
    null,
  );
  const [optimisticEnabled, setOptimisticEnabled] = useState<boolean | null>(
    null,
  );

  const dirty = useMemo(
    () => isGraphDirty(graph, saved.graph),
    [graph, saved.graph],
  );
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const savingRef = useRef(saving);
  savingRef.current = saving;

  // Each write starts from the URL as it is now, not from the last render's copy: a selection change and a details
  // change in the same event must both land.
  const writeUrlParams = useCallback(
    (change: (params: URLSearchParams) => void) => {
      const current = new URLSearchParams(window.location.search);
      const next = new URLSearchParams(current);
      change(next);
      if (next.toString() !== current.toString()) {
        setSearchParams(next, { replace: true });
      }
    },
    [setSearchParams],
  );

  const setSelectionParams = useCallback(
    (selection: { nodeIds: string[]; edgeIds: string[] }) => {
      const wanted = urlParamsForSelection(selection);
      writeUrlParams((next) => {
        for (const [key, value] of [
          ["node", wanted.node],
          ["edge", wanted.edge],
        ] as const) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        // The details modal shows a step, so it closes when no step is selected.
        if (!wanted.node) next.delete(NODE_DETAILS_PARAM);
      });
    },
    [writeUrlParams],
  );

  const editor = useWorkflowEditor({
    graph,
    catalog: WORKFLOW_CATALOG,
    // The editor's own graph goes back as it is: a different object would read as an outside edit and clear undo.
    onChange: (next) => {
      setGraph(next);
      setServerIssues((current) => (current.length === 0 ? current : []));
    },
    onSelectionChange: setSelectionParams,
    initialSelection: {
      nodeIds: nodeParam ? [nodeParam] : [],
      edgeIds: edgeParam && !nodeParam ? [edgeParam] : [],
    },
  });
  const snapshot = useEditorSnapshot(editor);
  const validation = editor.validate();
  // Steps that just appeared in the graph are ringed on the canvas.
  const graphNodeIds = useMemo(
    () => snapshot.graph.nodes.map((node) => node.id),
    [snapshot.graph.nodes],
  );
  const recentNodeIds = useNewNodeHighlight(graphNodeIds);

  // The step details modal. Its open state is in the URL, next to the step it shows. The rest is for this visit
  // only: a step this page did not start with, opened for the first time, opens quiet (see `NodeDetailsDialog`).
  const detailsOpen = isNodeDetailsOpen(searchParams);
  const [startingNodeIds] = useState(
    () => new Set(workflow.graph.nodes.map((node) => node.id)),
  );
  const detailsShown = useRef(new Set<string>());
  const [detailsEntry, setDetailsEntry] = useState<{
    nodeId: string;
    focusName: boolean;
    quiet: boolean;
  } | null>(null);
  const detailsNode =
    detailsOpen && nodeParam
      ? snapshot.graph.nodes.find((node) => node.id === nodeParam)
      : undefined;
  const entry =
    detailsNode && detailsEntry?.nodeId === detailsNode.id
      ? detailsEntry
      : null;

  const openDetails = useCallback(
    (nodeId: string, focus?: "name") => {
      const fresh =
        !startingNodeIds.has(nodeId) && !detailsShown.current.has(nodeId);
      detailsShown.current.add(nodeId);
      setDetailsEntry({ nodeId, focusName: focus === "name", quiet: fresh });
      const { selection: picked } = editor.getSnapshot();
      if (
        picked.nodeIds.length !== 1 ||
        picked.nodeIds[0] !== nodeId ||
        picked.edgeIds.length > 0
      ) {
        editor.select({ nodeIds: [nodeId], edgeIds: [] });
      }
      writeUrlParams((next) => {
        next.set("node", nodeId);
        next.delete("edge");
        next.set(NODE_DETAILS_PARAM, NODE_DETAILS_OPEN);
      });
    },
    [editor, writeUrlParams, startingNodeIds],
  );

  // Closing leaves the step selected.
  const closeDetails = useCallback(() => {
    setDetailsEntry(null);
    writeUrlParams((next) => next.delete(NODE_DETAILS_PARAM));
  }, [writeUrlParams]);

  const engageDetails = useCallback(() => {
    setDetailsEntry((current) =>
      current?.quiet ? { ...current, quiet: false } : current,
    );
  }, []);

  // Back or forward can close the modal without `closeDetails`, and its entry goes with it.
  useEffect(() => {
    if (!detailsOpen) setDetailsEntry(null);
  }, [detailsOpen]);

  // Connections
  const providerConnections = useProviderConnections();
  const { refetch: recheckConnections } = providerConnections;
  const missing = useMemo(
    () =>
      missingConnections(
        snapshot.graph,
        WORKFLOW_CATALOG,
        providerConnections.data?.providers,
      ),
    [snapshot.graph, providerConnections.data],
  );
  const unconnected = useMemo(() => unconnectedByNode(missing), [missing]);
  // The step creator reads each provider's status from here; a provider left out reads as unknown.
  const connections = useMemo(
    () =>
      Object.fromEntries(
        (providerConnections.data?.providers ?? []).map((entry) => [
          entry.provider,
          entry.status,
        ]),
      ),
    [providerConnections.data],
  );
  // A provider the creator asks for may not be used by this workflow yet, so the popover lists it as well.
  const [connectRequest, setConnectRequest] = useState<string | null>(null);
  const connectList = useMemo(() => {
    const requested = (providerConnections.data?.providers ?? []).find(
      (entry) => entry.provider === connectRequest,
    );
    if (
      !requested ||
      missing.some((entry) => entry.provider === requested.provider)
    ) {
      return missing;
    }
    return [
      ...missing,
      {
        provider: requested.provider,
        connectWith: requested.connectWith,
        ...(requested.detail ? { detail: requested.detail } : {}),
        nodeIds: [],
      },
    ];
  }, [connectRequest, missing, providerConnections.data]);
  function requestConnect(provider: string) {
    setConnectRequest(provider);
    setConnectionsOpen(true);
  }
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  useEffect(() => {
    if (missing.length === 0) setConnectionsOpen(false);
  }, [missing.length]);

  // A link, or the agent, can point at another step: follow the URL.
  useEffect(() => {
    const current = urlParamsForSelection(editor.getSnapshot().selection);
    if (current.node === nodeParam && current.edge === edgeParam) return;
    editor.select({
      nodeIds: nodeParam ? [nodeParam] : [],
      edgeIds: edgeParam && !nodeParam ? [edgeParam] : [],
    });
    // A link to a step this graph does not have selects nothing: drop it from the URL.
    const after = urlParamsForSelection(editor.getSnapshot().selection);
    if (after.node !== nodeParam || after.edge !== edgeParam) {
      setSelectionParams(editor.getSnapshot().selection);
    }
  }, [editor, nodeParam, edgeParam, setSelectionParams]);

  const adopt = useCallback((latest: GetWorkflowResult) => {
    setGraph(latest.graph);
    setSaved({ graph: latest.graph, version: latest.version });
    setServerIssues([]);
    setConflict(null);
  }, []);

  // A save or an agent edit elsewhere made a newer version: a clean page takes
  // it, a page with unsaved edits asks first.
  useEffect(() => {
    if (workflow.version <= saved.version) return;
    if (dirtyRef.current || savingRef.current) {
      setConflict((current) => current ?? { latest: workflow.version });
      return;
    }
    adopt(workflow);
    // Only a new version from the server runs this. Watching `saved` too would
    // adopt the server's copy the moment an optimistic save moves it on.
  }, [workflow.version, workflow.graph]);

  const refreshWorkflowQueries = useCallback(() => {
    for (const name of [
      "get-factory-workflow",
      "list-factory-workflows",
      "list-factory-workflow-versions",
      "list-factory-workflow-runs",
      "get-workflow-node-data",
    ]) {
      void queryClient.invalidateQueries({ queryKey: ["action", name] });
    }
  }, [queryClient]);

  // Rename, as the list does it: the new name shows in the workflow and list reads at once. A rename that did
  // not land puts the old name back. A schedule that did not follow keeps the new name and says so.
  const { mutate: renameWorkflowMutation } = useActionMutation<
    RenameWorkflowResult,
    { factoryId: string; workflowId: string; name: string }
  >("rename-factory-workflow");
  const renameWorkflow = useCallback(
    (name: string) => {
      const previousName = workflow.name;
      const showName = (next: string) => {
        queryClient.setQueriesData<GetWorkflowResult>(
          {
            queryKey: ["action", "get-factory-workflow"],
            predicate: (query) =>
              (query.queryKey[2] as { workflowId?: unknown } | undefined)
                ?.workflowId === workflowId,
          },
          (current) => (current ? { ...current, name: next } : current),
        );
        queryClient.setQueriesData<ListWorkflowsResult>(
          { queryKey: ["action", "list-factory-workflows"] },
          (current) =>
            current ? withRenamedWorkflow(current, workflowId, next) : current,
        );
      };
      void queryClient.cancelQueries({
        queryKey: ["action", "get-factory-workflow"],
      });
      void queryClient.cancelQueries({
        queryKey: ["action", "list-factory-workflows"],
      });
      showName(name);
      renameWorkflowMutation(
        { factoryId, workflowId, name },
        {
          onError: (error) => {
            const failure = readActionFailure(error, ws.errors.unknown);
            if (failure.errorCode === "job_sync_failed") {
              toast.error(ws.list.renamedJobFailed);
            } else {
              showName(previousName);
              toast.error(ws.list.renameFailed(failure.message));
            }
            void queryClient.invalidateQueries({
              queryKey: ["action", "get-factory-workflow"],
            });
            void queryClient.invalidateQueries({
              queryKey: ["action", "list-factory-workflows"],
            });
          },
        },
      );
    },
    [
      factoryId,
      workflowId,
      workflow.name,
      queryClient,
      renameWorkflowMutation,
      ws,
    ],
  );

  // Save

  const { mutateAsync: saveWorkflow } = useActionMutation<
    SaveWorkflowResult,
    {
      factoryId: string;
      workflowId: string;
      expectedVersion: number;
      graph: WorkflowGraph;
    }
  >("save-factory-workflow", { skipActionQueryInvalidation: true });

  // Resolves to whether the page's edits are saved, so a caller that needs them saved can go on.
  const save = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return false;
    if (!dirtyRef.current) return true;
    const sent = editor.getSnapshot().graph;
    const previous = saved;
    savingRef.current = true;
    setSaving(true);
    setServerIssues([]);
    // The page reads as saved at once and goes back if the save is refused.
    setSaved({ graph: sent, version: previous.version + 1 });
    try {
      const result = await saveWorkflow({
        factoryId,
        workflowId,
        expectedVersion: previous.version,
        graph: sent,
      });
      setSaved({ graph: sent, version: result.version });
      if (result.disabledBySave) {
        setOptimisticEnabled(false);
        toast.warning(ws.save.switchedOff);
      }
      refreshWorkflowQueries();
      return true;
    } catch (error) {
      const failure = classifySaveFailure(error, ws.errors.unknown);
      if (failure.kind === "job_sync_failed" && failure.savedVersion !== null) {
        // The version is saved; its schedule is not. Staying unsaved keeps Save
        // available, and saving again writes the schedule through.
        setSaved({ graph: previous.graph, version: failure.savedVersion });
        toast.error(ws.save.jobSyncFailed);
        refreshWorkflowQueries();
        return false;
      }
      setSaved(previous);
      switch (failure.kind) {
        case "graph_invalid":
          setServerIssues(failure.issues);
          setProblemsOpen(true);
          toast.error(ws.save.invalid(failure.issueCount));
          break;
        case "version_conflict":
          setConflict({ latest: failure.currentVersion });
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-factory-workflow"],
          });
          break;
        case "workflow_not_found":
          toast.error(ws.save.notFound);
          break;
        default:
          toast.error(ws.save.failed(failure.message));
      }
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [
    editor,
    factoryId,
    queryClient,
    refreshWorkflowQueries,
    saveWorkflow,
    saved,
    workflowId,
    ws,
  ]);

  // Command or Ctrl+S saves, as it does everywhere else.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "s"
      ) {
        return;
      }
      event.preventDefault();
      void save();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [save]);

  async function loadLatest() {
    const latest = await refetch();
    if (!latest) {
      toast.error(ws.page.loadFailed);
      return;
    }
    adopt(latest);
  }

  function keepMine() {
    // Based on the newest version, the next save becomes the newest one.
    const latest = Math.max(conflict?.latest ?? 0, workflow.version);
    setSaved((current) => ({ ...current, version: latest }));
    setConflict(null);
  }

  // Leaving with unsaved edits

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && leavesOpenWorkflow(currentLocation, nextLocation),
  );
  const leaving = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Test run, test step, run now, and turning on

  const runMutation = useActionMutation<
    RunWorkflowResult,
    {
      factoryId: string;
      workflowId: string;
      mode: RunWorkflowMode;
      testNodeId?: string;
      sampleItemIds?: string[];
    }
  >("run-factory-workflow", { skipActionQueryInvalidation: true });
  const { mutateAsync: runWorkflow } = runMutation;

  const setRunParam = useCallback(
    (runId: string | null) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (runId) next.set("run", runId);
          else next.delete("run");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // The scheduler's id for a run it has not started yet, which has no steps to read until it does.
  const [queuedRunId, setQueuedRunId] = useState<string | null>(null);

  const startRun = useCallback(
    async (
      request: {
        mode: RunWorkflowMode;
        testNodeId?: string;
        sampleItemIds?: string[];
      },
      messages: { started: string; failed: (failure: ActionFailure) => string },
    ): Promise<boolean> => {
      try {
        const result = await runWorkflow({
          factoryId,
          workflowId,
          ...request,
        });
        setQueuedRunId(result.runId);
        setRunParam(result.runId);
        toast.success(messages.started);
        refreshWorkflowQueries();
        return true;
      } catch (error) {
        toast.error(
          messages.failed(readActionFailure(error, ws.errors.unknown)),
        );
        return false;
      }
    },
    [
      factoryId,
      refreshWorkflowQueries,
      runWorkflow,
      setRunParam,
      workflowId,
      ws,
    ],
  );

  const testMessages = useCallback(
    () => ({
      started: ws.run.started,
      failed: (failure: ActionFailure) =>
        isUnknownActionError(failure)
          ? ws.run.unavailable
          : ws.run.failed(failure.message),
    }),
    [ws],
  );

  // Both tests run what is saved, so unsaved edits are saved first; a save that
  // failed or has problems has said why, and the test does not start.
  const testRun = useCallback(async () => {
    if (!(await save())) return;
    await startRun({ mode: "dry" }, testMessages());
  }, [save, startRun, testMessages]);

  const testStep = useCallback(
    async (nodeId: string, sampleItemIds: string[]): Promise<boolean> => {
      if (!(await save())) return false;
      return startRun(
        {
          mode: "test",
          testNodeId: nodeId,
          ...(sampleItemIds.length > 0 ? { sampleItemIds } : {}),
        },
        testMessages(),
      );
    },
    [save, startRun, testMessages],
  );

  const [runNowOpen, setRunNowOpen] = useState(false);
  const diagnostics = useCopyDiagnostics({ factoryId, workflowId });
  const runNow = useCallback(
    () =>
      startRun(
        { mode: "live" },
        {
          started: ws.run.liveStarted,
          failed: (failure) => ws.run.liveFailed(failure.message),
        },
      ),
    [startRun, ws],
  );

  const enableMutation = useActionMutation<
    SetEnabledResult,
    { factoryId: string; workflowId: string; enabled: boolean }
  >("set-factory-workflow-enabled", { skipActionQueryInvalidation: true });
  const enabled = optimisticEnabled ?? workflow.enabled;

  // Turning on is refused for a provider that is not connected: the page's own
  // answer may be older than that, so it asks again before listing them.
  async function showMissingConnections(refusal: string) {
    const latest = await recheckConnections();
    const stillMissing = missingConnections(
      editor.getSnapshot().graph,
      WORKFLOW_CATALOG,
      latest.data?.providers,
    );
    if (stillMissing.length > 0) setConnectionsOpen(true);
    else toast.error(ws.run.enableFailed(refusal));
  }

  function changeEnabled(next: boolean) {
    if (next && dirty) {
      toast(ws.toolbar.saveBeforeEnable);
      return;
    }
    setOptimisticEnabled(next);
    enableMutation.mutate(
      { factoryId, workflowId, enabled: next },
      {
        onSuccess: () => {
          void refetch().finally(() => setOptimisticEnabled(null));
          refreshWorkflowQueries();
        },
        onError: (error) => {
          setOptimisticEnabled(null);
          const failure = readActionFailure(error, ws.errors.unknown);
          if (failure.errorCode === "dry_run_required") {
            toast(ws.list.dryRunRequired, {
              action: { label: ws.list.runTest, onClick: () => void testRun() },
            });
            return;
          }
          if (failure.errorCode === "connection_required") {
            void showMissingConnections(failure.message);
            return;
          }
          toast.error(ws.run.enableFailed(failure.message));
        },
      },
    );
  }

  // What the canvas shows from a run and from an item's path

  // A run just queued is addressed by the scheduler's id and has no row until the scheduler starts it. The
  // recent runs are watched for it, so no read goes out for a run that is not there yet.
  const runPending = runParam !== null && runParam === queuedRunId;
  const queuedRuns = useActionQuery<ListRunsResult>(
    "list-factory-workflow-runs",
    { factoryId, workflowId, limit: RECENT_RUNS },
    {
      enabled: runPending,
      refetchInterval: runPending ? RUN_WATCH_INTERVAL_MS : false,
    },
  );
  const startedRunId = runPending
    ? queuedRuns.data?.runs.find((run) => run.historyRowId === queuedRunId)?.id
    : undefined;
  useEffect(() => {
    if (!startedRunId) return;
    setQueuedRunId(null);
    setRunParam(startedRunId);
  }, [startedRunId, setRunParam]);
  useEffect(() => {
    if (!runPending) return;
    // The run has not failed, only not started: it still shows in the run picker once the scheduler starts it.
    const timer = window.setTimeout(() => {
      setQueuedRunId(null);
      setRunParam(null);
      refreshWorkflowQueries();
    }, QUEUED_RUN_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [runPending, setRunParam, refreshWorkflowQueries]);

  const runQuery = useActionQuery<RunDetail>(
    "get-factory-workflow-run",
    { factoryId, runId: runParam ?? "" },
    {
      enabled: Boolean(runParam) && !runPending,
      // A run opened by the scheduler's id from a link can still be a moment
      // ahead of its row.
      retry: (failureCount, error) =>
        failureCount < 4 &&
        readActionFailure(error, "").errorCode === "workflow_run_not_found",
      refetchInterval: (query) =>
        (query.state.data as RunDetail | undefined)?.run.status === "running"
          ? RUN_WATCH_INTERVAL_MS
          : false,
    },
  );

  const openedRunId = runQuery.data?.run.id;
  useEffect(() => {
    if (openedRunId && runParam && openedRunId !== runParam) {
      setRunParam(openedRunId);
    }
  }, [openedRunId, runParam, setRunParam]);

  useEffect(() => {
    if (!runQuery.isError || !runParam) return;
    toast.error(ws.runPicker.loadFailed);
    setRunParam(null);
  }, [runQuery.isError, runParam, setRunParam, ws]);

  const serverNodeIds = useMemo(
    () => new Set(workflow.graph.nodes.map((node) => node.id)),
    [workflow.graph],
  );
  const runStatus = runParam ? runQuery.data?.run.status : undefined;
  // Items waiting at each Wait, for the canvas badges. Read again while the run goes, and once it ends.
  const parkedCounts = useParkedCounts({
    factoryId,
    workflowId,
    running: runStatus === "running",
  });
  const overlay = useMemo(
    () =>
      runOverlay(runParam ? runQuery.data?.steps : undefined, {
        running: runStatus === "running",
      }),
    [runParam, runQuery.data, runStatus],
  );
  // A node's audit and item data are read while its run is still going, so both are read again once the run settles.
  const lastRun = useRef<{ id: string; status: string } | null>(null);
  useEffect(() => {
    const run = runQuery.data?.run;
    const before = lastRun.current;
    lastRun.current = run ? { id: run.id, status: run.status } : null;
    if (
      run &&
      run.status !== "running" &&
      before?.id === run.id &&
      before.status === "running"
    ) {
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-workflow-node-audit"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-workflow-node-data"],
      });
    }
  }, [runQuery.data, queryClient]);

  // The agent

  // The request the agent gets, with the workflow's context attached.
  function agentRequest(message: string) {
    return {
      message,
      context: buildAgentContext({
        factoryId,
        workflowId,
        name: workflow.name,
        version: saved.version,
        enabled,
        dirty,
        selection: editor.getSelectionContext(),
        issues: validation.issues,
        graph: snapshot.graph,
        runId: runParam,
      }),
      contextLabel: ws.toolbar.askAgentContextLabel,
      openSidebar: true,
    };
  }

  // Opens the agent sidebar with a request typed in, not sent, and the workflow's context attached.
  function openAgent(message: string) {
    sendToAgentChat({ ...agentRequest(message), submit: false });
  }

  function askAgent() {
    openAgent(ws.toolbar.askAgentPrefill);
  }

  // The empty canvas's link: the agent builds the workflow from what the user writes after the prefill.
  function describeWorkflow() {
    openAgent(canvasStrings.canvasActions.describeFirstPrefill);
  }

  // A request from the New workflow dialog is sent once, as the canvas opens. If the chat does not confirm it, it is typed in instead, so it is not lost.
  useEffect(() => {
    const request = takeNewWorkflowRequest(workflowId);
    if (request === null) return;
    const message = newWorkflowAgentMessage(
      canvasStrings.canvasActions.describeFirstPrefill,
      request,
    );
    void sendToAgentChatAndConfirm({
      ...agentRequest(message),
      chatTarget: "local",
      submit: true,
    }).then(({ delivered }) => {
      if (!delivered) {
        sendToAgentChat({
          ...agentRequest(message),
          chatTarget: "local",
          submit: false,
        });
      }
    });
    // The request is taken once and the context is the one the canvas opened with, so later renders have nothing to send.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  // What the agent can see beyond the URL: unsaved edits and problems.
  useEffect(() => {
    const key = `${WORKFLOW_EDITOR_STATE_KEY}:${TAB_ID}`;
    const timer = window.setTimeout(() => {
      void writeClientAppState(
        key,
        buildEditorAppState({
          workflowId,
          name: workflow.name,
          baseVersion: saved.version,
          dirty,
          saving,
          issues: validation.issues,
          graph: snapshot.graph,
          selection: snapshot.selection,
          runId: runParam,
        }),
        { requestSource: TAB_ID },
        // coercion-ok: a best-effort mirror for the agent; the page works without it.
      ).catch(() => {});
    }, STATE_WRITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    workflowId,
    workflow.name,
    saved.version,
    dirty,
    saving,
    validation,
    snapshot.graph,
    snapshot.selection,
    runParam,
  ]);
  useEffect(() => {
    const key = `${WORKFLOW_EDITOR_STATE_KEY}:${TAB_ID}`;
    return () => {
      void deleteClientAppState(key, { requestSource: TAB_ID }).catch(
        // coercion-ok: the key is tab-scoped and the agent ignores one whose workflow is not open.
        () => {},
      );
    };
  }, []);

  // Problems list and jumping to one

  const problems = useMemo(
    () =>
      listProblems({
        graph: snapshot.graph,
        issues: validation.issues,
        serverIssues,
        strings: { canvas: canvasStrings, workflow: ws },
      }),
    [snapshot.graph, validation, serverIssues, canvasStrings, ws],
  );
  function jumpToProblem(problem: ProblemRow) {
    setProblemsOpen(false);
    if (problem.nodeId) editor.select({ nodeIds: [problem.nodeId] });
    else if (problem.edgeId) editor.select({ edgeIds: [problem.edgeId] });
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <WorkflowToolbar
        workflowName={workflow.name}
        onRename={renameWorkflow}
        backHref={backHref}
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        problems={problems}
        problemsOpen={problemsOpen}
        onProblemsOpenChange={setProblemsOpen}
        onJumpToProblem={jumpToProblem}
        testing={runMutation.isPending}
        onTestRun={() => void testRun()}
        onRunNow={() => setRunNowOpen(true)}
        enabled={enabled}
        enabledPending={enableMutation.isPending}
        onEnabledChange={changeEnabled}
        connections={
          <ConnectionsPopover
            missing={connectList}
            open={connectionsOpen}
            onOpenChange={(open) => {
              setConnectionsOpen(open);
              if (!open) setConnectRequest(null);
            }}
            onConnected={() => void recheckConnections()}
          />
        }
        runPicker={
          <RunPicker
            factoryId={factoryId}
            workflowId={workflowId}
            currentVersion={saved.version}
            runId={runParam}
            onSelect={setRunParam}
          />
        }
        onOpenVersions={() => setVersionsOpen(true)}
        onAskAgent={askAgent}
        onCopyDiagnostics={diagnostics.copy}
        diagnosticsPending={diagnostics.pending}
      />

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <ParkedCountsContext.Provider value={parkedCounts}>
            <WorkflowCanvas
              editor={editor}
              overlay={overlay}
              unconnected={unconnected}
              connections={connections}
              onConnectProvider={requestConnect}
              onDescribeStep={openAgent}
              minimap={snapshot.graph.nodes.length >= MINIMAP_NODE_COUNT}
              onTest={() => void testRun()}
              unsaved={dirty}
              testing={runMutation.isPending}
              onTestStep={(nodeId) => void testStep(nodeId, [])}
              recentNodeIds={recentNodeIds}
              onDescribeFirst={describeWorkflow}
              onOpenDetails={openDetails}
            />
          </ParkedCountsContext.Provider>
          {runParam ? (
            <div className="pointer-events-none absolute start-3 top-3 z-10">
              <RunModeBadge mode={runQuery.data?.run.mode ?? null} />
            </div>
          ) : null}
        </div>
        <NodeDetailsDialog
          editor={editor}
          factoryId={factoryId}
          workflowId={workflowId}
          node={detailsNode}
          onClose={closeDetails}
          focusName={entry?.focusName ?? false}
          quiet={entry?.quiet ?? false}
          onEngage={engageDetails}
          runId={runParam}
          runPending={runPending}
          steps={overlay?.stepByNodeId}
          serverNodeIds={serverNodeIds}
          dirty={dirty}
          starting={saving || runMutation.isPending}
          onTestStep={testStep}
          parkedCount={
            detailsNode ? (parkedCounts?.get(detailsNode.id) ?? 0) : 0
          }
          onTestWorkflow={() => void testRun()}
          onAskAgent={() => openAgent(ws.nodeDetails.askAgentPrefill)}
        />
      </div>

      <WorkflowVersionsPanel
        factoryId={factoryId}
        workflowId={workflowId}
        open={versionsOpen}
        onOpenChange={(open) => {
          setVersionsOpen(open);
          if (open || versionParam === null) return;
          setSearchParams(
            (current) => {
              const next = new URLSearchParams(current);
              next.delete("version");
              return next;
            },
            { replace: true },
          );
        }}
        highlightVersion={versionParam}
        dirty={dirty}
        enabled={enabled}
        onRestored={(result: RestoreWorkflowResult) => {
          if (result.disabledBySave) setOptimisticEnabled(false);
          void refetch().then((latest) => {
            if (latest) adopt(latest);
            setOptimisticEnabled(null);
          });
          refreshWorkflowQueries();
          if (result.disabledBySave) toast.warning(ws.save.switchedOff);
        }}
      />

      <AlertDialog
        open={conflict !== null}
        onOpenChange={(open) => {
          if (!open) setConflict(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ws.conflict.dialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {ws.conflict.body(conflict?.latest ?? null)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="grid gap-2 text-sm text-muted-foreground">
            <li>{ws.conflict.loadLatestNote}</li>
            <li>{ws.conflict.keepMineNote}</li>
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={keepMine}>
              {ws.conflict.keepMine}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void loadLatest()}>
              {ws.conflict.loadLatest}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {diagnostics.dialog}

      <AlertDialog open={runNowOpen} onOpenChange={setRunNowOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ws.liveRun.dialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>{ws.liveRun.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ws.liveRun.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runNow()}>
              {ws.toolbar.runNow}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && !leaving.current) blocker.reset?.();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ws.leave.dialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>{ws.leave.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>
              {ws.leave.stay}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                leaving.current = true;
                blocker.proceed?.();
              }}
            >
              {ws.leave.discard}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
