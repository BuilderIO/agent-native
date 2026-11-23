import { sendToAgentChatAndConfirm } from "@agent-native/core/client/agent-chat";
import { fetchAgentEngineConfiguredState } from "@agent-native/core/client/agent-engine-readiness";
import {
  actionErrorCode,
  callAction,
  isTerminalActionError,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import { useSession } from "@agent-native/core/client/use-session";
import { useDocumentTitle } from "@agent-native/toolkit/app/shared";
import { useIsMobile } from "@agent-native/toolkit/hooks";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  NotebookAgentComposerSuppressed,
  WorkspaceAgent,
} from "@/components/agent";
import {
  notebookThreadId,
  notebookThreadPath,
  withNotebookAgentView,
} from "@/components/agent/notebook-thread-route";
import { queueThreadSubmission } from "@/components/agent/search-submission";
import {
  ProjectEditor,
  type AddCellOptions,
  type NotebookCellOutputState,
  type NotebookConnection,
  type NotebookProjectView,
} from "@/components/notebook";
import {
  applyNotebookCommand,
  readTitleSnapshot,
  titleCommand,
} from "@/components/notebook/notebook-title";
import { notebookUndoOrigin } from "@/components/notebook/notebook-undo-origin";
import { NotebookLegacyProposals } from "@/components/notebook/NotebookLegacyProposals";
import { versionPreviewCopy } from "@/components/notebook/ProjectHistoryPanel";
import type { SectionChange } from "@/components/notebook/types";
import { useAppLayout } from "@/components/notebook/useAppLayout";
import { useNotebookAgentReview } from "@/components/notebook/useNotebookAgentReview";
import { useNotebookResults } from "@/components/notebook/useNotebookResults";
import { useNotebookRun } from "@/components/notebook/useNotebookRun";
import { defaultCellTitle } from "@/components/notebook/utils";
import { ProjectCollectionsPickerDialog } from "@/components/projects/ProjectCollectionsPickerDialog";
import { ProjectSharePopover } from "@/components/sharing/ProjectSharePopover";
import { Button } from "@/components/ui/button";
import {
  ADDABLE_CELL_KINDS,
  type AddableCellKind,
  type CellKind,
} from "@/lib/model/cell-types";
import type { CellContents, ProjectDocument } from "@/lib/model/contracts";
import { compareOrder } from "@/lib/model/order";
import type { ProjectVersion } from "@/lib/model/project-version-contracts";
import type { ResolvedRoute } from "@/routes/routing/registry";

import type getProject from "../../../actions/get-project";
import type publishProject from "../../../actions/publish-project";
import {
  ANALYTICS_CONTROL_IDS,
  capabilityAllowed,
} from "../../../shared/analytics-control-ids";
import type {
  EditorPreferences,
  EditorPreferencesPatch,
} from "../../../shared/editor-preferences";
import {
  notebookCommandSchema,
  notebookOperationReadSchema,
} from "../../../shared/notebook-operations";
import {
  CONTRACT_VERSION,
  type DraftHead,
} from "../../../shared/notebook-snapshot-contract";
import {
  notebookUndoRequestSchema,
  type NotebookUndoRequest,
} from "../../../shared/notebook-undo";
import {
  SAMPLE_DATA_SOURCE_ID,
  SAMPLE_DATA_SOURCE_NAME,
} from "../../../shared/sample-data-contract";
import { mergeSavedCell } from "./merge-saved-cell";
import { ProjectNotFound } from "./ProjectNotFound";
import { useWorkspaceData } from "./WorkspaceDataContext";

const LEGACY_RUN_POLL_INTERVAL_MS = 1500;
const NOTEBOOK_COMPOSER_READY_TIMEOUT_MS = 8_000;

async function waitForNotebookComposerReady(): Promise<void> {
  if (typeof document === "undefined") return;
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function")
      requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
  const container = document.querySelector(".ws-agent-notebook");
  if (!container) return;
  const isReady = () => {
    const composer = container.querySelector('[aria-label="Message agent..."]');
    return (
      composer !== null &&
      composer.getAttribute("aria-disabled") !== "true" &&
      !composer.hasAttribute("disabled")
    );
  };
  if (isReady()) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      clearTimeout(timeout);
      clearInterval(poll);
      resolve();
    };
    const observer =
      typeof MutationObserver === "function"
        ? new MutationObserver(() => {
            if (isReady()) finish();
          })
        : null;
    observer?.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-disabled", "disabled", "aria-label"],
    });
    const poll = setInterval(() => {
      if (isReady()) finish();
    }, 50);
    const timeout = setTimeout(finish, NOTEBOOK_COMPOSER_READY_TIMEOUT_MS);
  });
}

/**
 * Project notebook route.
 *
 * The editor is a pure surface: every callback below maps to a project action,
 * and outputs come only from the persisted project read. No local storage and
 * no client version ids are sent; the server writes the working version.
 */
/** The cell kinds the add-cell action can create today. */
function rethrowMutationError(error: unknown): never {
  throw error;
}

export { ADDABLE_CELL_KINDS };

export function NotebookPage({ route }: { route: ResolvedRoute }) {
  const projectId = route.params.projectLocator ?? "";
  const rawVersion = route.params.version;
  const requestedVersion =
    rawVersion && rawVersion !== "latest" && rawVersion !== "draft"
      ? rawVersion
      : undefined;
  const isAppBuilderRoute = route.params.view === "app" || route.view === "ui";
  const location = useLocation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const t = useT();
  const workspace = useWorkspaceData();
  const { session, isLoading: sessionLoading } = useSession();
  const currentOrg = useOrg();
  const bootstrapQuery = useActionQuery(
    "get-workspace-bootstrap",
    {},
    { enabled: workspace === undefined, retry: 1 },
  );
  const identity =
    workspace?.shell ??
    (bootstrapQuery.isError ? undefined : bootstrapQuery.data);
  const identityMatches = Boolean(
    identity &&
    !sessionLoading &&
    session?.email &&
    identity.user.email.toLowerCase() === session.email.toLowerCase() &&
    !currentOrg.isPending &&
    !currentOrg.isError &&
    currentOrg.data.orgId === identity.workspace.id,
  );
  const canCreateProject = Boolean(
    identity &&
    !sessionLoading &&
    session?.email &&
    identity.user.email.toLowerCase() === session.email.toLowerCase() &&
    !currentOrg.isError &&
    (currentOrg.isPending || currentOrg.data.orgId === identity.workspace.id) &&
    capabilityAllowed(
      identity.capabilities,
      ANALYTICS_CONTROL_IDS.createProject,
    ),
  );
  const orgId = identityMatches ? identity?.workspace.id : undefined;
  const preferenceOwner = sessionLoading
    ? undefined
    : session?.email.toLowerCase();
  const editorPreferences = useActionQuery<EditorPreferences>(
    "get-editor-preferences",
    {},
    { enabled: !!preferenceOwner, queryKeyScope: [preferenceOwner] },
  );
  const { mutate: saveEditorPreferences } = useActionMutation<
    EditorPreferences,
    EditorPreferencesPatch
  >("set-editor-preferences", {
    scope: { id: `analytics-2:editor-preferences:${preferenceOwner ?? ""}` },
    skipActionQueryInvalidation: true,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-editor-preferences"],
      });
    },
  });
  const notebookView = new URLSearchParams(location.search).get("notebookView");
  const agentOpen =
    !isAppBuilderRoute &&
    notebookView !== "source" &&
    notebookView !== "graph" &&
    notebookView !== "run-stats" &&
    (notebookView === "agent" ||
      (notebookView !== "notebook" &&
        (notebookThreadId(location.search) !== null ||
          editorPreferences.data?.agentOpen === true)));

  const readIdentity = `${orgId ?? ""}:${session?.email ?? ""}:${projectId}:${requestedVersion ?? ""}`;
  const currentReadIdentity = useRef({ key: readIdentity });
  if (currentReadIdentity.current.key !== readIdentity)
    currentReadIdentity.current = { key: readIdentity };
  const canonicalRead = useRef<{
    identity: { key: string };
    sequence: number;
    data: Awaited<ReturnType<typeof getProject.run>>;
  } | null>(null);
  const projectQuery = useActionQuery(
    "get-project",
    requestedVersion ? { projectId, version: requestedVersion } : { projectId },
    {
      enabled: projectId.length > 0,
      retry: 1,
      onRequestStart: () => currentReadIdentity.current,
      onServerResult: (data, { requestContext }) => {
        if (requestContext !== currentReadIdentity.current) return;
        canonicalRead.current = {
          identity: currentReadIdentity.current,
          sequence: (canonicalRead.current?.sequence ?? 0) + 1,
          data,
        };
      },
    },
  );
  const verifyProjectData = useCallback(
    (data: typeof projectQuery.data) =>
      orgId &&
      session?.email &&
      data?.viewer.email.toLowerCase() === session.email.toLowerCase() &&
      data.viewer.orgId === orgId &&
      data.project.id === projectId
        ? data
        : undefined,
    [orgId, projectId, session?.email],
  );
  const projectData = verifyProjectData(projectQuery.data);
  const creationNavigation = location.state as {
    focusProjectTitle?: boolean;
    projectRenamed?: boolean;
  } | null;
  const canEdit =
    !projectQuery.isError &&
    projectData?.canEdit === true &&
    requestedVersion === undefined;
  const canUseBuilder =
    !projectQuery.isError &&
    capabilityAllowed(
      projectData?.capabilities,
      ANALYTICS_CONTROL_IDS.editProject,
    );
  const [previewState, setPreviewState] = useState<{
    identity: string;
    version: ProjectVersion;
    observedHead: DraftHead;
    restoreOpId: string;
  } | null>(null);
  const previewIdentity = `${orgId ?? ""}:${session?.email ?? ""}:${projectId}`;
  const activePreview =
    previewState?.identity === previewIdentity ? previewState : null;
  const preview = activePreview?.version ?? null;
  const currentPreviewIdentity = useRef(previewIdentity);
  currentPreviewIdentity.current = previewIdentity;
  const [confirmRestore, setConfirmRestore] = useState(false);
  const previewQuery = useActionQuery(
    "get-project",
    { projectId, version: preview?.id ?? "" },
    { enabled: preview !== null, retry: 1 },
  );
  const previewData = verifyProjectData(previewQuery.data);
  const displayData = preview ? previewData : projectData;
  const capabilities =
    displayData?.capabilities ??
    (identityMatches
      ? identity?.capabilities?.filter(
          ({ controlId }) => controlId === ANALYTICS_CONTROL_IDS.dataBrowse,
        )
      : undefined) ??
    [];
  const restoreVersion = useActionMutation("restore-project-version");
  const connectionsQuery = useActionQuery("list-data-connections", {});
  const importConnection = useActionMutation("import-project-connection", {
    errorNotification: "caller",
  });
  const undoOperation = useActionMutation("undo-notebook-operation", {
    errorNotification: "caller",
  });
  const pendingUndo = useRef<{
    identity: string;
    request: NotebookUndoRequest;
    active: boolean;
  } | null>(null);

  const updateProject = useActionMutation("update-project");
  const favoriteProject = useActionMutation("favorite-project", {
    errorNotification: "caller",
  });
  const saveCell = useActionMutation("save-project-cell");
  const chartSaveQueues = useRef(new Map<string, Promise<string>>());
  const chartSavedRevisions = useRef(
    new Map<string, { acknowledged: Set<string | undefined>; saved: string }>(),
  );
  const clearProjectOutputs = useActionMutation("clear-project-outputs");
  const addCell = useActionMutation("add-project-cell");
  const deleteCell = useActionMutation("delete-project-cell");
  const [pendingCellDeletes, setPendingCellDeletes] = useState<
    ReadonlyMap<string, ReadonlySet<string>>
  >(new Map());
  const moveCell = useActionMutation("move-project-cell");
  const duplicateCell = useActionMutation("duplicate-project-cell");
  const pasteCell = useActionMutation("paste-project-cell");
  const manageComponent = useActionMutation("manage-component");
  const { mutateAsync: readLegacyPage } = useActionMutation(
    "run-project-cell",
    {
      skipActionQueryInvalidation: true,
    },
  );
  const { mutateAsync: cancelLegacyQuery } = useActionMutation(
    "cancel-project-cell",
    {
      skipActionQueryInvalidation: true,
    },
  );
  const workingVersionId = projectData?.project.workingVersionId;
  const canUseDraftResults =
    !preview &&
    !projectQuery.isError &&
    (canEdit ||
      projectData?.capabilities.some(
        ({ controlId, status }) =>
          status === "allowed" &&
          (controlId === ANALYTICS_CONTROL_IDS.runDraftSql ||
            controlId === ANALYTICS_CONTROL_IDS.runDraftPython),
      ) === true);
  const latestProject = useCallback(
    () =>
      verifyProjectData(
        queryClient.getQueryData<typeof projectQuery.data>([
          "action",
          "get-project",
          { projectId },
        ]),
      )?.project,
    [projectId, queryClient, verifyProjectData],
  );
  const pythonCellIds = useMemo(
    () =>
      new Set(
        (projectData?.project.cells ?? []).flatMap(({ id, contents }) =>
          contents.kind === "code" && contents.language === "python"
            ? [id]
            : [],
        ),
      ),
    [projectData?.project.cells],
  );
  const hasKernelCells = useCallback(
    () =>
      latestProject()?.cells.some(
        ({ contents }) =>
          contents.kind === "code" ||
          (contents.kind === "sql" && contents.connectionMode === "dataframes"),
      ) === true,
    [latestProject],
  );
  const executionIdentity = `${readIdentity}:${workingVersionId ?? ""}`;
  const resultIdentity = `${executionIdentity}:${canUseDraftResults}`;
  const resultScope = useRef<{ identity: string } | null>({
    identity: resultIdentity,
  });
  if (resultScope.current?.identity !== resultIdentity)
    resultScope.current = { identity: resultIdentity };
  useEffect(() => {
    resultScope.current ??= { identity: resultIdentity };
    const observed = resultScope.current;
    return () => {
      if (resultScope.current === observed) resultScope.current = null;
    };
  }, [resultIdentity]);
  const execution = useNotebookRun({
    projectId,
    identity: executionIdentity,
    enabled: canUseDraftResults,
    workspaceId: orgId,
    workingVersionId,
    hasKernelCells,
  });
  const resultPages = useNotebookResults({
    identity: resultIdentity,
    projectId,
    execution,
    pythonCellIds,
  });
  const refreshExecution = execution.refreshSnapshot;
  const clearSelection = execution.clearSelection;
  const trashProject = useActionMutation("trash-project");
  const archiveProject = useActionMutation("archive-project");
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const collectionsQuery = useActionQuery(
    "list-collections",
    {},
    { enabled: collectionsOpen, retry: 1 },
  );
  const projectCollectionsQuery = useActionQuery(
    "list-project-collections",
    {},
    { enabled: collectionsOpen, retry: 1 },
  );
  const addToCollection = useActionMutation("add-project-to-collection");
  const duplicate = useActionMutation("duplicate-project");
  const [publishingProjectIds, setPublishingProjectIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const touchProject = useActionMutation("touch-project", {
    skipActionQueryInvalidation: true,
  });

  // Opening a project is a view: it feeds the recents order and the list's
  // "Last viewed by me" column. One touch per open, never on every render.
  const touchedProject = useRef<{
    identity: string;
    viewId: string;
    sent: boolean;
  } | null>(null);
  useEffect(() => {
    if (projectId === "" || !projectData?.project) return;
    if (touchedProject.current?.identity !== readIdentity)
      touchedProject.current = {
        identity: readIdentity,
        viewId: crypto.randomUUID(),
        sent: false,
      };
    const view = touchedProject.current;
    if (view.sent) return;
    view.sent = true;
    void touchProject
      .mutateAsync({ projectId, viewId: view.viewId })
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: ["action", "get-workspace-activity"],
        }),
      )
      .catch(() => {
        // A failed view record must never block reading the notebook.
        view.sent = false;
      });
  }, [
    projectId,
    projectData?.project,
    queryClient,
    readIdentity,
    touchProject,
  ]);

  const refreshProject = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["action", "get-project"] }),
      queryClient.invalidateQueries({
        queryKey: ["action", "get-workspace-activity"],
      }),
    ]);
  }, [queryClient]);

  const review = useNotebookAgentReview({
    projectId,
    identity: executionIdentity,
    head: projectData?.notebook?.snapshot.head,
    editable: canEdit && !preview && route.params.view !== "app",
    agentOpen,
    refreshAccepted: async () => {
      await Promise.all([refreshProject(), refreshExecution()]);
    },
  });

  const askDataQuestion = async (
    question: string,
    { handoff = false }: { handoff?: boolean } = {},
  ) => {
    const readiness = await fetchAgentEngineConfiguredState();
    if (readiness !== "configured")
      throw new Error(
        t(
          readiness === "missing"
            ? "agentChat.setup.connectToStart"
            : "agentChat.setup.providerStatusUnavailable",
        ),
      );
    const targetTabId = projectData?.notebook
      ? await review.ensureThread()
      : undefined;
    const agentLocation = withNotebookAgentView(location);
    const agentPath = targetTabId
      ? notebookThreadPath(agentLocation, targetTabId)
      : agentLocation;
    if (handoff) await navigate(agentPath, { replace: true, state: null });
    else if (
      !agentOpen ||
      (targetTabId && notebookThreadId(location.search) !== targetTabId)
    )
      await navigate(agentPath);
    const prompt = {
      message: question,
      context: `Current project id: ${projectId}. Call get-project with { projectId: "${projectId}" } before reading or changing cells.`,
    };
    let result;
    if (targetTabId) {
      if (!orgId) throw new Error(t("notebook.sendFailed"));
      result = await queueThreadSubmission(targetTabId, orgId, prompt);
    } else {
      await waitForNotebookComposerReady();
      result = await sendToAgentChatAndConfirm({
        ...prompt,
        chatTarget: "local",
        submit: true,
        openSidebar: false,
      });
    }
    if (!result.delivered) throw new Error(t("notebook.sendFailed"));
  };
  const pendingAskQuestion = useRef<{
    projectId: string;
    question: string;
  } | null>(null);
  const handedOffQuestion = (() => {
    const state = location.state as { askQuestion?: unknown } | null;
    if (typeof state?.askQuestion === "string" && state.askQuestion.trim()) {
      pendingAskQuestion.current = {
        projectId,
        question: state.askQuestion,
      };
      return state.askQuestion;
    }
    return pendingAskQuestion.current?.projectId === projectId
      ? pendingAskQuestion.current.question
      : null;
  })();
  const askHandoff = useRef(askDataQuestion);
  askHandoff.current = askDataQuestion;
  const handedOffKey = useRef<string | null>(null);
  const handoffReady = Boolean(orgId && projectData?.project.id === projectId);
  useEffect(() => {
    if (!handedOffQuestion || !handoffReady) return;
    const key = `${projectId}\n${handedOffQuestion}`;
    if (handedOffKey.current === key) return;
    handedOffKey.current = key;
    pendingAskQuestion.current = null;
    askHandoff
      .current(handedOffQuestion, { handoff: true })
      .catch((error: unknown) => {
        console.warn(
          "[analytics] Could not ask the handed-off question",
          error,
        );
        toast.error(t("notebook.sendFailed"));
      });
  }, [handedOffQuestion, handoffReady, projectId, t]);

  const refetchProjectQuery = projectQuery.refetch;
  const readLegacyResult = useCallback(async () => {
    const identity = currentReadIdentity.current;
    const sequence = canonicalRead.current?.sequence ?? 0;
    const refreshed = await refetchProjectQuery();
    if (refreshed.error) throw refreshed.error;
    const read = canonicalRead.current;
    if (
      currentReadIdentity.current !== identity ||
      !read ||
      read.identity !== identity ||
      read.sequence <= sequence
    )
      throw new Error(t("queryError.interrupted"));
    const data = verifyProjectData(read.data);
    if (!data?.canEdit || data.project.workingVersionId !== workingVersionId)
      throw new Error(t("queryError.interrupted"));
    return data;
  }, [refetchProjectQuery, t, verifyProjectData, workingVersionId]);

  const legacyRuns = useMemo(() => {
    const active = new Map<string, string>();
    if (!canUseDraftResults || !projectData) return active;
    for (const cell of projectData.project.cells) {
      const state = projectData.queryStates[cell.id];
      if (
        cell.contents.kind === "sql" &&
        cell.contents.dataConnectionId &&
        cell.contents.dataConnectionId !== SAMPLE_DATA_SOURCE_ID &&
        !execution.cells?.[cell.id]?.attempt &&
        !execution.runningIds.has(cell.id) &&
        (state?.status === "running" || state?.status === "cancelling")
      )
        active.set(cell.id, state.requestId);
    }
    return active;
  }, [canUseDraftResults, execution.cells, execution.runningIds, projectData]);
  const currentLegacyRuns = useRef(legacyRuns);
  currentLegacyRuns.current = legacyRuns;
  const legacyCancelLock = useRef<string | null>(null);
  const [stoppingLegacyScope, setStoppingLegacyScope] =
    useState<typeof resultScope.current>(null);
  const hasLegacyRuns = legacyRuns.size > 0;
  useEffect(() => {
    if (!hasLegacyRuns) return;
    const scope = resultScope.current;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const observe = async () => {
      try {
        const current = await readLegacyResult();
        if (disposed || resultScope.current !== scope) return;
        await Promise.all(
          [...currentLegacyRuns.current].map(async ([cellId, requestId]) => {
            const state = current.queryStates[cellId];
            if (state?.requestId !== requestId || state.busy) return;
            if (state.status === "cancelling") {
              await cancelLegacyQuery({
                projectId,
                cellId,
                requestId,
                operation: "status",
              });
            } else if (state.status === "running") {
              await readLegacyPage({
                projectId,
                cellId,
                requestId,
                operation: "poll",
              });
            }
          }),
        );
      } catch (error) {
        if (
          !disposed &&
          resultScope.current === scope &&
          actionErrorCode(error) !== "project_query_changed"
        )
          console.error("Could not observe the saved warehouse query", error);
      } finally {
        if (!disposed && resultScope.current === scope)
          timer = setTimeout(() => void observe(), LEGACY_RUN_POLL_INTERVAL_MS);
      }
    };
    timer = setTimeout(() => void observe(), LEGACY_RUN_POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [
    cancelLegacyQuery,
    hasLegacyRuns,
    projectId,
    readLegacyPage,
    readLegacyResult,
  ]);

  const cancelExecution = useCallback(
    async (cellId?: string) => {
      const requestId = cellId ? legacyRuns.get(cellId) : undefined;
      if (!cellId || !requestId) {
        await execution.cancel(cellId);
        return;
      }
      const scope = resultScope.current;
      if (
        scope?.identity !== resultIdentity ||
        legacyCancelLock.current === requestId ||
        currentLegacyRuns.current.get(cellId) !== requestId
      )
        return;
      legacyCancelLock.current = requestId;
      setStoppingLegacyScope(scope);
      try {
        const result = await cancelLegacyQuery({
          projectId,
          cellId,
          requestId,
        });
        if (resultScope.current !== scope) return;
        if (result.status === "error")
          toast.error(t("queryError.cancelFailed"));
        await refreshProject();
      } catch {
        if (resultScope.current === scope)
          toast.error(t("queryError.cancelFailed"));
      } finally {
        if (legacyCancelLock.current === requestId)
          legacyCancelLock.current = null;
        setStoppingLegacyScope((current) =>
          current === scope ? null : current,
        );
      }
    },
    [
      cancelLegacyQuery,
      execution.cancel,
      legacyRuns,
      projectId,
      refreshProject,
      resultIdentity,
      t,
    ],
  );

  const onPublished = useCallback(
    (release: Awaited<ReturnType<typeof publishProject.run>>) => {
      queryClient.setQueryData(
        ["action", "get-project", { projectId }],
        (current: typeof projectQuery.data) => {
          if (!current) return current;
          return {
            ...current,
            project: {
              ...current.project,
              publishedVersionId: release.releaseId,
              publishedHead: release.head,
            },
            capabilities: current.capabilities.map((decision) =>
              decision.controlId === ANALYTICS_CONTROL_IDS.openPublishedApp
                ? {
                    controlId: decision.controlId,
                    scope: decision.scope,
                    status: "allowed",
                    target: { kind: "route", routeId: "app" },
                  }
                : decision,
            ),
          };
        },
      );
      void refreshProject();
    },
    [projectId, queryClient, refreshProject],
  );

  const pendingRename = useRef<{
    identity: typeof currentReadIdentity.current;
    title: string;
    command: ReturnType<typeof titleCommand>;
  } | null>(null);
  const onRename = useCallback(
    async (title: string, applyToLatest = false) => {
      const accepted = projectData?.notebook;
      if (!accepted) {
        await updateProject
          .mutateAsync({ projectId, title })
          .catch(rethrowMutationError);
        await refreshProject();
        return;
      }
      const identity = currentReadIdentity.current;
      const prior = pendingRename.current;
      const retry =
        !applyToLatest && prior?.identity === identity && prior.title === title;
      const snapshot = applyToLatest
        ? await readTitleSnapshot(projectId)
        : accepted;
      if (currentReadIdentity.current !== identity) return;
      const command = retry ? prior.command : titleCommand(snapshot, title);
      const intent = { identity, title, command };
      pendingRename.current = intent;
      const receipt = await applyNotebookCommand(command, retry);
      if (receipt.status === "conflict") {
        await refreshProject();
        throw Object.assign(new Error(t("notebookCreation.titleChanged")), {
          errorCode: "notebook_metadata_conflict",
        });
      }
      if (pendingRename.current === intent) pendingRename.current = null;
      await refreshProject();
    },
    [projectData?.notebook, projectId, refreshProject, t, updateProject],
  );

  const onSaveDescription = useCallback(
    async (description: string) => {
      await updateProject
        .mutateAsync({ projectId, description })
        .catch(rethrowMutationError);
      await refreshProject();
    },
    [projectId, refreshProject, updateProject],
  );

  // The source's project options menu duplicates the project and lands on the
  // copy, the same way its home row menu does.
  const onDuplicate = useCallback(async () => {
    const { project: copy } = await duplicate
      .mutateAsync({ projectId })
      .catch(rethrowMutationError);
    await navigate(`/project/${encodeURIComponent(copy.id)}/latest`);
  }, [duplicate, navigate, projectId]);

  const onMoveCell = useCallback(
    async (cellId: string, direction: "up" | "down") => {
      await moveCell
        .mutateAsync({
          projectId,
          cellId,
          direction,
          originId: notebookUndoOrigin(),
        })
        .catch(rethrowMutationError);
      await refreshProject();
    },
    [moveCell, projectId, refreshProject],
  );

  const onMoveCellTo = useCallback(
    async (
      cellId: string,
      target: { cellId: string; placement: "before" | "after" },
    ) => {
      await moveCell
        .mutateAsync({
          projectId,
          cellId,
          target,
          originId: notebookUndoOrigin(),
        })
        .catch(rethrowMutationError);
      await refreshProject();
    },
    [moveCell, projectId, refreshProject],
  );

  const onSectionChange = useCallback(
    async (change: SectionChange) => {
      const accepted = projectData?.notebook;
      if (!accepted) throw new Error(t("notebook.saveFailed"));
      const revision = accepted.cells.find(
        ({ id }) => id === change.cellId,
      )?.revision;
      const command = notebookCommandSchema.parse({
        protocol: CONTRACT_VERSION,
        opId: crypto.randomUUID(),
        projectId,
        workingVersionId: accepted.snapshot.head.versionId,
        observedHead: accepted.snapshot.head,
        originId: notebookUndoOrigin(),
        changes: [
          change.type === "set-section"
            ? { ...change, expectedRevision: revision }
            : {
                ...change,
                expectedOrderRevision: accepted.resources.orderRevision,
              },
        ],
      });
      try {
        const receipt = await applyNotebookCommand(command, false).catch(
          (error: unknown) => {
            if (isTerminalActionError(error)) throw error;
            return applyNotebookCommand(command, true);
          },
        );
        if (receipt.status === "conflict")
          throw new Error(t("notebook.cellEditChanged"));
      } finally {
        await Promise.all([refreshProject(), refreshExecution()]);
      }
    },
    [projectData?.notebook, projectId, refreshExecution, refreshProject, t],
  );

  const onDuplicateCell = useCallback(
    async (cellId: string) => {
      const result = await duplicateCell
        .mutateAsync({
          projectId,
          cellId,
          originId: notebookUndoOrigin(),
        })
        .catch(rethrowMutationError);
      const created = result.project.cells.find(
        (cell) => cell.id === result.createdCellId,
      );
      if (!created) throw new Error(t("notebook.saveFailed"));
      await refreshProject();
    },
    [duplicateCell, projectId, refreshProject, t],
  );

  const onPasteCell = useCallback(
    async (
      afterCellId: string,
      contents: Omit<CellContents, "id" | "order">,
    ) => {
      await pasteCell
        .mutateAsync({ projectId, afterCellId, contents })
        .catch(rethrowMutationError);
      await refreshProject();
    },
    [pasteCell, projectId, refreshProject],
  );

  const onCreateComponent = useCallback(
    async (name: string, cellIds: readonly string[]) => {
      await manageComponent
        .mutateAsync({
          operation: "create",
          projectId,
          name,
          cellIds: [...cellIds],
        })
        .catch(rethrowMutationError);
      await queryClient.invalidateQueries({
        queryKey: ["action", "list-components"],
      });
    },
    [manageComponent, projectId, queryClient],
  );

  const onFavorite = useCallback(
    async (favorited: boolean) => {
      const projectKey = ["action", "get-project", { projectId }];
      await queryClient.cancelQueries({ queryKey: projectKey });
      const result = await favoriteProject
        .mutateAsync({
          projectId,
          favorited,
        })
        .catch(rethrowMutationError);
      if (
        result.project.id !== projectId ||
        result.project.favorited !== favorited
      )
        throw new Error(t("notebook.saveFailed"));
      queryClient.setQueryData(
        projectKey,
        (current: typeof projectQuery.data) =>
          current && current.project.id === result.project.id
            ? {
                ...current,
                project: {
                  ...current.project,
                  favorited: result.project.favorited,
                },
              }
            : current,
      );
      await queryClient.invalidateQueries({ queryKey: ["action"] });
      return result.project.favorited;
    },
    [favoriteProject, projectId, queryClient, t],
  );

  const onClearOutputs = useCallback(async () => {
    await clearProjectOutputs
      .mutateAsync({ projectId })
      .catch(rethrowMutationError);
    clearSelection();
    await Promise.all([refreshProject(), refreshExecution()]);
    toast.success(t("notebook.runOutputsCleared"));
  }, [
    projectId,
    refreshProject,
    refreshExecution,
    clearProjectOutputs,
    clearSelection,
    t,
  ]);

  const onSaveCell = useCallback(
    async (
      cellId: string,
      contents: CellContents,
      draftExpectedUpdatedAt?: string,
      inputOptionsResultId?: string,
      suppressReactiveRun?: boolean,
    ) => {
      // Name the revision this editor last rendered, so a change made elsewhere
      // is refused instead of overwritten. A refused save still refreshes, so
      // the cell shows the newer text and its Changed elsewhere state.
      const expectedUpdatedAt =
        draftExpectedUpdatedAt ??
        projectData?.project.cells.find((cell) => cell.id === cellId)
          ?.updatedAt;
      const save = async (revision: string | undefined) => {
        const saved = await saveCell
          .mutateAsync({
            projectId,
            cellId,
            contents,
            originId: notebookUndoOrigin(),
            expectedUpdatedAt: revision,
            ...(inputOptionsResultId ? { inputOptionsResultId } : {}),
            ...(suppressReactiveRun ? { suppressReactiveRun } : {}),
          })
          .catch(rethrowMutationError);
        queryClient.setQueryData(
          ["action", "get-project", { projectId }],
          (current: typeof projectQuery.data) =>
            current
              ? {
                  ...current,
                  project: mergeSavedCell(
                    current.project,
                    saved.project,
                    cellId,
                    revision,
                  ),
                }
              : current,
        );
        void refreshExecution();
        void refreshProject();
        const savedRevision = saved.project.cells.find(
          (cell) => cell.id === cellId,
        )?.updatedAt;
        if (!savedRevision) throw new Error("Saved cell revision is missing");
        return savedRevision;
      };
      try {
        if (contents.kind !== "chart") return await save(expectedUpdatedAt);
        const key = `${projectId}:${cellId}`;
        const previous = chartSaveQueues.current.get(key);
        const last = chartSavedRevisions.current.get(key);
        const revision = last?.acknowledged.has(expectedUpdatedAt)
          ? last.saved
          : expectedUpdatedAt;
        const pending = previous ? previous.then(save) : save(revision);
        chartSaveQueues.current.set(key, pending);
        void pending.then(
          (saved) => {
            const current = chartSavedRevisions.current.get(key);
            const acknowledged = current?.acknowledged.has(expectedUpdatedAt)
              ? new Set(current.acknowledged)
              : new Set([expectedUpdatedAt]);
            acknowledged.add(saved);
            chartSavedRevisions.current.set(key, { acknowledged, saved });
          },
          () => chartSavedRevisions.current.delete(key),
        );
        const clear = () => {
          if (chartSaveQueues.current.get(key) === pending)
            chartSaveQueues.current.delete(key);
        };
        void pending.then(clear, clear);
        return await pending;
      } catch (error) {
        await refreshProject();
        throw error;
      }
    },
    [
      projectId,
      projectData,
      queryClient,
      refreshExecution,
      refreshProject,
      saveCell,
    ],
  );
  const onAddCell = useCallback(
    async (kind: CellKind, afterCellId?: string, options?: AddCellOptions) => {
      if (!(ADDABLE_CELL_KINDS as readonly CellKind[]).includes(kind))
        throw new Error("That cell type cannot be added to a project yet.");
      const projectKey = ["action", "get-project", { projectId }];
      const startingProject =
        queryClient.getQueryData<typeof projectQuery.data>(projectKey)?.project;
      const result = await addCell
        .mutateAsync({
          projectId,
          originId: notebookUndoOrigin(),
          kind: kind as AddableCellKind,
          ...(afterCellId === undefined ? {} : { afterCellId }),
          ...(options?.beforeCellId === undefined
            ? {}
            : { beforeCellId: options.beforeCellId }),
          ...(options?.inputType === undefined
            ? {}
            : { inputType: options.inputType }),
          ...(options?.name === undefined ? {} : { name: options.name }),
          ...(options?.dataframe === undefined
            ? {}
            : { dataframe: options.dataframe }),
          ...(options?.componentVersionId === undefined
            ? {}
            : { componentVersionId: options.componentVersionId }),
          ...(options?.source === undefined ? {} : { source: options.source }),
          ...(options?.dataConnectionId === undefined
            ? {}
            : { dataConnectionId: options.dataConnectionId }),
          ...(options?.parentSectionId === undefined
            ? {}
            : { parentSectionId: options.parentSectionId }),
        })
        .catch(rethrowMutationError);
      if (!result.createdCellId)
        throw new Error("The new cell could not be identified.");
      const created = result.project.cells.find(
        (cell) => cell.id === result.createdCellId,
      );
      if (!created) throw new Error("The new cell could not be identified.");
      const updated = queryClient.setQueryData<
        NonNullable<typeof projectQuery.data>
      >(projectKey, (current: typeof projectQuery.data) => {
        if (
          !current ||
          current.project.id !== result.project.id ||
          !startingProject
        )
          return current;
        if (
          current.project.workingVersionId !== result.project.workingVersionId
        ) {
          if (current.project !== startingProject) return current;
          return { ...current, project: result.project };
        }
        return {
          ...current,
          project: {
            ...current.project,
            cells: current.project.cells.some((cell) => cell.id === created.id)
              ? current.project.cells
              : [...current.project.cells, created],
          },
        };
      });
      if (
        !updated ||
        updated.project.workingVersionId !== result.project.workingVersionId ||
        !updated.project.cells.some((cell) => cell.id === created.id)
      )
        throw new Error("The new cell could not be identified.");
      void queryClient.invalidateQueries({ queryKey: projectKey });
      await queryClient.invalidateQueries({
        queryKey: ["action", "get-workspace-activity"],
        refetchType: "none",
      });
      return result.createdCellId;
    },
    [addCell, projectId, queryClient],
  );

  const onDeleteCell = useCallback(
    async (cellId: string) => {
      setPendingCellDeletes((previous) => {
        const next = new Map(previous);
        next.set(projectId, new Set([...(next.get(projectId) ?? []), cellId]));
        return next;
      });
      try {
        await deleteCell
          .mutateAsync({
            projectId,
            cellId,
            originId: notebookUndoOrigin(),
          })
          .catch(rethrowMutationError);
        queryClient.setQueryData(
          ["action", "get-project", { projectId }],
          (current: typeof projectQuery.data) =>
            current
              ? {
                  ...current,
                  project: {
                    ...current.project,
                    cells: current.project.cells.filter(
                      (cell) => cell.id !== cellId,
                    ),
                  },
                }
              : current,
        );
        void refreshProject().catch(() => undefined);
      } finally {
        setPendingCellDeletes((previous) => {
          const next = new Map(previous);
          const cells = new Set(next.get(projectId));
          cells.delete(cellId);
          if (cells.size) next.set(projectId, cells);
          else next.delete(projectId);
          return next;
        });
      }
    },
    [deleteCell, projectId, queryClient, refreshProject],
  );

  const onUndoCellEdit = useCallback(
    async (redo: boolean) => {
      const project = projectData?.project;
      if (!project || !canEdit || preview) return;
      const identity = `${readIdentity}:${project.workingVersionId}`;
      const pending =
        pendingUndo.current?.identity === identity ? pendingUndo.current : null;
      if (pending?.active) return;
      const intent = pending ?? {
        identity,
        request: notebookUndoRequestSchema.parse({
          projectId,
          workingVersionId: project.workingVersionId,
          opId: crypto.randomUUID(),
          originId: notebookUndoOrigin(),
          direction: redo ? "redo" : "undo",
        }),
        active: true,
      };
      intent.active = true;
      pendingUndo.current = intent;
      const clearIntent = () => {
        if (pendingUndo.current === intent) pendingUndo.current = null;
      };
      try {
        const receipt = await undoOperation
          .mutateAsync(intent.request)
          .catch(async (error: unknown) => {
            if (isTerminalActionError(error)) {
              clearIntent();
              if (actionErrorCode(error) === "notebook_conflict")
                await refreshProject();
              throw error;
            }
            const read = notebookOperationReadSchema.parse(
              await callAction(
                "get-notebook-operation",
                {
                  projectId,
                  opId: intent.request.opId,
                },
                { method: "GET" },
              ),
            );
            if (read.status === "absent") throw error;
            return read.receipt;
          });
        clearIntent();
        if (receipt.status === "no_change") return;
        await Promise.all([refreshProject(), refreshExecution()]);
        if (receipt.status === "conflict")
          throw new Error(t("notebook.cellEditChanged"));
        if (
          intent.request.direction === "undo" &&
          receipt.delta.cells.some(
            ({ id }) => !project.cells.some((cell) => cell.id === id),
          )
        )
          toast.success(t("notebook.cellRestored"));
      } finally {
        intent.active = false;
      }
    },
    [
      canEdit,
      preview,
      projectData,
      projectId,
      readIdentity,
      refreshExecution,
      refreshProject,
      t,
      undoOperation,
    ],
  );

  const { mutateAsync: importProjectConnection } = importConnection;
  const onImportConnection = useCallback(
    async (connectionId: string) => {
      await importProjectConnection({ projectId, connectionId });
    },
    [importProjectConnection, projectId],
  );

  const onSelectConnection = useCallback(
    async (cellId: string, connectionId: string | null) => {
      const latest = queryClient.getQueryData<typeof projectQuery.data>([
        "action",
        "get-project",
        { projectId },
      ]);
      const cell = verifyProjectData(latest)?.project.cells.find(
        (item) => item.id === cellId,
      );
      if (!cell) throw new Error("That cell is not in this project.");
      if (cell.contents.kind !== "sql")
        throw new Error("Only SQL cells can use a data connection.");
      const { connectionMode: _connectionMode, ...contents } = cell.contents;
      let saved;
      try {
        saved = await saveCell
          .mutateAsync({
            projectId,
            cellId,
            expectedUpdatedAt: cell.updatedAt,
            contents: {
              ...contents,
              dataConnectionId: connectionId,
              ...(connectionId === null
                ? { connectionMode: "dataframes" as const }
                : {}),
            },
          })
          .catch(rethrowMutationError);
      } catch (error) {
        await refreshProject();
        throw error;
      }
      await Promise.all([refreshProject(), refreshExecution()]);
      const revision = saved.project.cells.find(
        (item) => item.id === cellId,
      )?.updatedAt;
      if (revision == null) throw new Error(t("notebook.saveFailed"));
      return revision;
    },
    [
      projectId,
      queryClient,
      refreshExecution,
      refreshProject,
      saveCell,
      t,
      verifyProjectData,
    ],
  );

  const onTrash = useCallback(async () => {
    await trashProject.mutateAsync({ projectId }).catch(rethrowMutationError);
    await queryClient.invalidateQueries({
      queryKey: ["action", "get-workspace-activity"],
    });
    await navigate("/home");
  }, [navigate, projectId, queryClient, trashProject]);

  const onArchive = useCallback(async () => {
    const result = await archiveProject
      .mutateAsync({ projectId })
      .catch(rethrowMutationError);
    if (result.project.id !== projectId || !result.project.archivedAt)
      throw new Error(t("notebook.saveFailed"));
    await queryClient.invalidateQueries({ queryKey: ["action"] });
    toast.success(t("projectMenu.archived"));
    await navigate("/home/all");
  }, [archiveProject, navigate, projectId, queryClient, t]);

  const onExportYaml = useCallback(async () => {
    const result = await callAction(
      "export-project-yaml",
      { projectId },
      { method: "GET" },
    );
    const url = URL.createObjectURL(
      new Blob([result.content], { type: "application/yaml" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = result.filename;
    link.click();
    URL.revokeObjectURL(url);
  }, [projectId]);

  const onSelectProjectView = useCallback(
    (next: NotebookProjectView) => {
      if (next === "app" && !canUseBuilder) return;
      const routeView = next === "app" ? "app" : "logic";
      const query = new URLSearchParams(location.search);
      if (next === "app") query.delete("notebookView");
      else query.set("notebookView", next);
      const search = query.toString();
      void navigate({
        pathname: `/project/${encodeURIComponent(projectId)}/latest/${routeView}`,
        search: search ? `?${search}` : "",
        hash: location.hash,
      });
      if (preferenceOwner && next !== "app" && (next === "agent") !== agentOpen)
        saveEditorPreferences({ agentOpen: next === "agent" });
    },
    [
      agentOpen,
      canUseBuilder,
      location.hash,
      location.search,
      navigate,
      preferenceOwner,
      projectId,
      saveEditorPreferences,
    ],
  );

  const connections = useMemo<NotebookConnection[]>(() => {
    const available: NotebookConnection[] = (
      connectionsQuery.data?.connections ?? []
    )
      .filter((connection) => !connection.isDraft)
      .map((connection) => ({
        id: connection.id,
        name: connection.name,
        type: connection.type,
        isDefault: connection.isDefault,
        ...(connection.description === undefined
          ? {}
          : { description: connection.description }),
      }));
    if (!connectionsQuery.data) {
      for (const selected of displayData?.selectedConnections ?? []) {
        if (selected.status === "available") available.push(selected);
      }
    }
    if (
      !available.some((connection) => connection.id === SAMPLE_DATA_SOURCE_ID)
    )
      available.push({
        id: SAMPLE_DATA_SOURCE_ID,
        name: SAMPLE_DATA_SOURCE_NAME,
        type: "sample",
        isDefault: false,
      });
    return available;
  }, [connectionsQuery.data, displayData?.selectedConnections]);

  const outputs = useMemo<
    Readonly<Record<string, NotebookCellOutputState | undefined>>
  >(() => {
    const records = displayData?.outputs ?? {};
    const states = displayData?.queryStates ?? {};
    const next: Record<string, NotebookCellOutputState> = {};
    for (const [cellId, record] of Object.entries(records)) {
      const state = states[cellId];
      const recoveryRequired =
        !execution.runningIds.has(cellId) &&
        (state?.status === "unavailable" ||
          ((record.status === "queued" || record.status === "running") &&
            !legacyRuns.has(cellId) &&
            displayData?.project.cells.some(
              (cell) => cell.id === cellId && cell.contents.kind === "sql",
            ) === true));
      if (record.status === "queued" || record.status === "running") {
        if (recoveryRequired) next[cellId] = { output: null, recoveryRequired };
        continue;
      }
      next[cellId] = {
        ranAt: record.ranAt,
        status: record.status,
        output: record.output,
        ...(recoveryRequired ? { recoveryRequired } : {}),
        ...(state
          ? {
              hasNextPage: state.hasNextPage,
              totalRows: state.totalRows,
              ...(state.canSeek ? { pageRequestId: state.requestId } : {}),
            }
          : {}),
      };
    }
    for (const [cellId, state] of Object.entries(states)) {
      if (execution.runningIds.has(cellId)) continue;
      if (state.status === "unavailable" && !next[cellId])
        next[cellId] = { output: null, recoveryRequired: true };
      if (state.status === "cancel_unknown")
        next[cellId] = {
          status: "error",
          output: {
            type: "error",
            code: "cancel_unknown",
            message: t("queryError.cancelUnknown"),
            detail: null,
          },
        };
    }
    return preview ? next : { ...next, ...resultPages.outputs };
  }, [
    displayData,
    execution.runningIds,
    legacyRuns,
    preview,
    resultPages.outputs,
    t,
  ]);

  const pendingPaging = useRef(new Map<string, Promise<void>>());
  const loadResultRows = useCallback(
    async (
      cellId: string,
      requiredRowCount: number,
      mountedRequestId: string | undefined,
    ) => {
      const scope = resultScope.current;
      if (!canUseDraftResults || scope?.identity !== resultIdentity)
        throw new Error(t("queryPaging.failed"));
      let requestId = mountedRequestId;
      for (;;) {
        const data = await readLegacyResult();
        if (resultScope.current !== scope)
          throw new Error(t("queryPaging.failed"));
        const state = data.queryStates[cellId];
        if (requestId && state?.requestId !== requestId)
          throw new Error(t("queryError.interrupted"));
        const output = data.outputs[cellId]?.output;
        const materialized = output?.type === "table" ? output.rows.length : 0;
        if (materialized >= requiredRowCount || (state && !state.hasNextPage))
          return materialized;
        if (!state) return null;
        requestId = state.requestId;
        await readLegacyPage({
          projectId,
          cellId,
          operation: "next-page",
          requestId,
        });
      }
    },
    [
      canUseDraftResults,
      projectId,
      readLegacyPage,
      readLegacyResult,
      resultIdentity,
      t,
    ],
  );

  const mountedQueryStates = projectData?.queryStates;
  const onLoadResultRows = useCallback(
    (cellId: string, requiredRowCount: number) => {
      const mountedRequestId = mountedQueryStates?.[cellId]?.requestId;
      const key = JSON.stringify([projectId, cellId, mountedRequestId ?? null]);
      const queue = pendingPaging.current;
      const previous = queue.get(key);
      const result = (async () => {
        if (previous) await previous;
        return loadResultRows(cellId, requiredRowCount, mountedRequestId);
      })();
      const settled = result.then(
        () => undefined,
        () => undefined,
      );
      queue.set(key, settled);
      void settled.then(() => {
        if (queue.get(key) === settled) queue.delete(key);
      });
      return result;
    },
    [loadResultRows, mountedQueryStates, projectId],
  );

  const onLoadResultPage = useCallback(
    async (cellId: string, rowOffset: number, requestId: string) => {
      const scope = resultScope.current;
      const output = outputs[cellId];
      if (
        !canUseDraftResults ||
        scope?.identity !== resultIdentity ||
        output?.pageRequestId !== requestId
      )
        throw new Error(t("queryPaging.failed"));
      if (output.artifactPage !== undefined)
        return resultPages.load(cellId, rowOffset, requestId);
      const result = await readLegacyPage({
        projectId,
        cellId,
        operation: "page",
        rowOffset,
        requestId,
      });
      if (resultScope.current === scope && result.output?.type === "table")
        return result.output.rows;
      throw new Error(t("queryPaging.failed"));
    },
    [
      canUseDraftResults,
      outputs,
      projectId,
      readLegacyPage,
      resultIdentity,
      resultPages.load,
      t,
    ],
  );

  const [shareOpen, setShareOpen] = useState(false);

  const pendingDeletes = pendingCellDeletes.get(projectId);
  const project = projectData?.project;
  // The project read carries its own viewer, so a read that matches the session
  // can be shown read-only while the bootstrap and org reads are still in flight.
  // Edit and share paths stay on the strict `project` above.
  const identityPending =
    !orgId &&
    (sessionLoading ||
      currentOrg.isPending ||
      (workspace === undefined && bootstrapQuery.isPending));
  const pendingIdentityProject =
    !project &&
    identityPending &&
    !projectQuery.isError &&
    projectQuery.data?.project.id === projectId &&
    !!session?.email &&
    projectQuery.data.viewer.email.toLowerCase() === session.email.toLowerCase()
      ? projectQuery.data.project
      : undefined;
  const editorVersion = useRef<{
    projectId: string;
    version?: string;
    generation: number;
  }>({ projectId, generation: 0 });
  if (editorVersion.current.projectId !== projectId) {
    editorVersion.current = { projectId, generation: 0 };
  }
  if (
    project?.workingVersionId &&
    editorVersion.current.version !== project.workingVersionId
  ) {
    if (editorVersion.current.version !== undefined)
      editorVersion.current.generation += 1;
    editorVersion.current.version = project.workingVersionId;
  }
  const visibleProject = preview
    ? previewData?.project
    : project && pendingDeletes?.size
      ? {
          ...project,
          cells: project.cells.filter((cell) => !pendingDeletes.has(cell.id)),
        }
      : (project ?? pendingIdentityProject);
  const appLayout = useAppLayout(
    visibleProject,
    connections,
    !preview && canUseBuilder && route.params.view === "app",
  );
  useDocumentTitle(
    [
      !projectQuery.error && project?.id === projectId
        ? canEdit
          ? t("notebookCreation.documentTitle", { title: project.title })
          : project.title
        : t("analytics.brand"),
    ],
    undefined,
  );
  if (!projectId) return null;

  // A project id that does not resolve is not a load that might finish later: the
  // server's own 404 (server/lib/project-action-access.ts:63, errorCode
  // project_not_found) says the same request can never succeed, so the reader gets
  // the app's not-found copy instead of an editable Untitled project. Anything else
  // stays the editor's error banner with its Retry.
  const projectErrorCode = actionErrorCode(projectQuery.error);
  if (
    (projectQuery.isError &&
      (projectErrorCode === "project_not_found" ||
        projectErrorCode === "project_version_not_found")) ||
    (isAppBuilderRoute && projectData && !canUseBuilder)
  ) {
    return <ProjectNotFound projectId={projectId} />;
  }

  return (
    <>
      {preview && (
        <div className="nb-banner" role="status">
          <span>{versionPreviewCopy(preview, t).viewing}</span>{" "}
          <button
            className="nb-text-button"
            type="button"
            onClick={() => setPreviewState(null)}
          >
            {t("notebook.exitVersionPreview")}
          </button>{" "}
          <button
            type="button"
            className="nb-button"
            onClick={() => setConfirmRestore(true)}
            disabled={!previewData || !projectData?.canEdit}
          >
            {t("dashboards.detail.previewRestore")}
          </button>
          {previewQuery.isError && (
            <p role="alert">{t("notebook.versionPreviewFailed")}</p>
          )}
        </div>
      )}
      {confirmRestore && activePreview && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !restoreVersion.isPending) setConfirmRestore(false);
          }}
        >
          <DialogContent aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>{t("notebook.confirmRestore")}</DialogTitle>
            </DialogHeader>
            <p>{versionPreviewCopy(activePreview.version, t).confirm}</p>
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                disabled={restoreVersion.isPending}
                onClick={() => setConfirmRestore(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                disabled={restoreVersion.isPending}
                onClick={() =>
                  void (async () => {
                    try {
                      await restoreVersion.mutateAsync({
                        projectId,
                        versionId: activePreview.version.id,
                        observedHead: activePreview.observedHead,
                        opId: activePreview.restoreOpId,
                      });
                      await refreshProject();
                      if (currentPreviewIdentity.current === previewIdentity) {
                        setConfirmRestore(false);
                        setPreviewState(null);
                      }
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : t("notebook.versionRestoreFailed"),
                      );
                    }
                  })()
                }
              >
                {t("dashboards.detail.restore")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {canEdit && creationNavigation?.projectRenamed === true && (
        <span className="sr-only" aria-live="polite">
          {t("notebookCreation.renamed")}
        </span>
      )}
      <ProjectEditor
        isVersionPreview={!!preview || requestedVersion !== undefined}
        appLayout={appLayout}
        focusTitle={
          !!project &&
          !preview &&
          creationNavigation?.focusProjectTitle === true
        }
        untitledOrdinal={project?.untitledOrdinal ?? null}
        key={`${projectId}:${requestedVersion ?? ""}:${preview ? `preview:${preview.id}` : `working:${editorVersion.current.generation}`}`}
        onPreviewVersion={async (version, observedHead) => {
          setConfirmRestore(false);
          setPreviewState({
            identity: previewIdentity,
            version,
            observedHead,
            restoreOpId: crypto.randomUUID(),
          });
        }}
        recoveryNotice={
          <>
            {project &&
            Object.values(outputs).some(
              (output) => output?.recoveryRequired,
            ) ? (
              <div className="nb-banner-stack">
                <div className="nb-banner nb-banner-danger" role="alert">
                  <p className="nb-banner-message">
                    {t("queryRecovery.unavailable")}
                  </p>
                  <ul>
                    {[...project.cells]
                      .sort((a, b) =>
                        compareOrder(a.contents.order, b.contents.order),
                      )
                      .filter((cell) => cell.contents.kind === "sql")
                      .map((cell, index) => ({
                        cell,
                        title:
                          cell.contents.label?.trim() ||
                          defaultCellTitle("sql", index + 1),
                      }))
                      .filter(({ cell }) => outputs[cell.id]?.recoveryRequired)
                      .map(({ cell, title }) => (
                        <li key={cell.id}>{title}</li>
                      ))}
                  </ul>
                </div>
              </div>
            ) : null}
            {review.notebook.editable &&
              projectData?.notebook &&
              projectData.project.ownerEmail.toLowerCase() ===
                projectData.viewer.email.toLowerCase() && (
                <NotebookLegacyProposals
                  key={executionIdentity}
                  projectId={projectId}
                  identity={executionIdentity}
                  ensureThread={review.ensureThread}
                  selectThread={review.notebook.selectThread}
                />
              )}
          </>
        }
        project={visibleProject ?? pendingProject(projectId)}
        connections={connections}
        addConnectionHref={
          identityMatches &&
          capabilityAllowed(
            identity?.capabilities,
            ANALYTICS_CONTROL_IDS.bigQueryConnectionCreate,
          )
            ? "/home/data?connect=1"
            : undefined
        }
        selectedConnectionStates={Object.fromEntries(
          (connectionsQuery.data
            ? []
            : (displayData?.selectedConnections ?? [])
          )
            .filter((connection) => connection.status !== "available")
            .map((connection) => [connection.id, connection.status]),
        )}
        connectionsLoading={connectionsQuery.isPending}
        connectionsError={
          connectionsQuery.isError
            ? connectionsQuery.error instanceof Error
              ? connectionsQuery.error.message
              : "Could not load data connections."
            : null
        }
        outputs={outputs}
        loading={
          preview
            ? previewQuery.isPending
            : projectQuery.isPending ||
              (!project && !pendingIdentityProject && !projectQuery.isError)
        }
        error={
          projectQuery.isError
            ? projectQuery.error instanceof Error
              ? projectQuery.error.message
              : "Could not load this project."
            : null
        }
        onRetryLoad={async () => {
          await projectQuery.refetch();
        }}
        canEdit={canEdit && !preview}
        capabilities={capabilities}
        view={
          canUseBuilder && isAppBuilderRoute
            ? "app"
            : notebookView === "source" ||
                notebookView === "graph" ||
                notebookView === "run-stats"
              ? notebookView
              : notebookView === "agent" || (isMobile && agentOpen)
                ? "agent"
                : "notebook"
        }
        onSelectView={onSelectProjectView}
        agentOpen={agentOpen}
        {...(projectData?.canEdit && !preview ? { onPublished } : {})}
        publishPending={publishingProjectIds.has(projectId)}
        onPublishingChange={(id, pending) => {
          setPublishingProjectIds((current) => {
            const next = new Set(current);
            if (pending) next.add(id);
            else next.delete(id);
            return next;
          });
        }}
        {...(project && !preview ? { onShare: () => setShareOpen(true) } : {})}
        {...(orgId
          ? {
              emptyState: {
                onAskDataQuestion: askDataQuestion,
              },
            }
          : {})}
        onRename={onRename}
        onFavorite={onFavorite}
        onSaveCell={onSaveCell}
        review={review.notebook.review}
        onLeaveReview={() => review.notebook.selectThread(null)}
        onSelectCell={review.selectCell}
        onFixWithAgent={
          review.notebook.editable
            ? (cellId, attemptId) => void review.fix(cellId, attemptId)
            : undefined
        }
        onUseAi={review.notebook.editable ? review.useAi : undefined}
        onSaveDescription={onSaveDescription}
        onClearOutputs={onClearOutputs}
        {...(identityMatches &&
        capabilityAllowed(
          identity?.capabilities,
          ANALYTICS_CONTROL_IDS.createProject,
        )
          ? { onDuplicate }
          : {})}
        {...(canCreateProject && workspace
          ? { onNewProject: workspace.quickCreateProject }
          : {})}
        {...(project ? { onExportYaml } : {})}
        {...(project && !preview && !project.archivedAt ? { onArchive } : {})}
        onAddToCollection={() => setCollectionsOpen(true)}
        onAddCell={onAddCell}
        onDeleteCell={async (cellId) => {
          await onDeleteCell(cellId);
        }}
        onMoveCell={onMoveCell}
        onMoveCellTo={onMoveCellTo}
        onSectionChange={projectData?.notebook ? onSectionChange : undefined}
        onDuplicateCell={onDuplicateCell}
        onPasteCell={onPasteCell}
        onCreateComponent={onCreateComponent}
        onUndoCellEdit={onUndoCellEdit}
        execution={{
          ...execution,
          runningIds: new Set([...execution.runningIds, ...legacyRuns.keys()]),
          stopping:
            execution.stopping ||
            (stoppingLegacyScope !== null &&
              stoppingLegacyScope === resultScope.current),
          cancel: cancelExecution,
        }}
        onSelectConnection={onSelectConnection}
        linkedConnectionIds={displayData?.importedConnectionIds}
        {...(canEdit && !preview ? { onImportConnection } : {})}
        onTrash={canEdit && !preview ? onTrash : undefined}
        {...(canUseDraftResults
          ? {
              onLoadResultRows,
              onLoadResultPage,
              onLoadPythonPage: resultPages.loadPython,
            }
          : {})}
        sharePanel={
          shareOpen && project ? (
            <ProjectSharePopover
              projectId={project.id}
              title={project.title}
              published={capabilityAllowed(
                projectData.capabilities,
                ANALYTICS_CONTROL_IDS.openPublishedApp,
              )}
              onClose={() => setShareOpen(false)}
            />
          ) : null
        }
        agentComposer={<NotebookAgentComposerSuppressed />}
        {...(orgId
          ? {
              agentPane: (
                <WorkspaceAgent
                  mode="notebook"
                  orgId={orgId}
                  projectId={projectId}
                  threadId={review.threadId}
                  notebook={review.notebook}
                />
              ),
            }
          : {})}
      />
      {collectionsOpen && project ? (
        <ProjectCollectionsPickerDialog
          projectTitle={project.title}
          collections={collectionsQuery.data?.collections ?? []}
          filedIds={
            projectCollectionsQuery.data?.assignments.find(
              (entry) => entry.projectId === projectId,
            )?.collectionIds ?? []
          }
          loading={
            collectionsQuery.isPending || projectCollectionsQuery.isPending
          }
          loadError={
            collectionsQuery.isError ||
            projectCollectionsQuery.isError ||
            (!collectionsQuery.isPending && !collectionsQuery.data) ||
            (!projectCollectionsQuery.isPending &&
              !projectCollectionsQuery.data)
          }
          onRetry={() => {
            void collectionsQuery.refetch();
            void projectCollectionsQuery.refetch();
          }}
          onClose={() => setCollectionsOpen(false)}
          onToggle={async (collectionId) => {
            await addToCollection.mutateAsync({ projectId, collectionId });
          }}
          staged
        />
      ) : null}
    </>
  );
}

/**
 * Structural document used only while the project read is pending or failed.
 * It has no cells, so no project content is fabricated; the editor is put in
 * its loading/error state by the props above.
 */
function pendingProject(projectId: string): ProjectDocument {
  return {
    id: projectId,
    ownerEmail: "",
    title: "",
    description: "",
    language: "python",
    statusId: null,
    favorited: false,
    trashedAt: null,
    archivedAt: null,
    lastOpenedAt: null,
    createdAt: "",
    updatedAt: "",
    workingVersionId: "",
    publishedVersionId: null,
    cells: [],
    collectionIds: [],
  };
}
