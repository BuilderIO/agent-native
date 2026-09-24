import type { AgentChatContextItem } from "@agent-native/toolkit/composer";
import { Skeleton } from "@agent-native/toolkit/design-system";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  DesignSystemArtifact,
  DesignSystemTargetContext,
  DesignSystemWorkspaceSnapshot,
} from "../shared/design-system-authoring.js";
import { AgentChatActivityProvider } from "./agent-chat-activity.js";
import { sendToAgentChatAndConfirm } from "./agent-chat.js";
import { AgentChatSurface } from "./AgentPanel.js";
import {
  deleteClientAppState,
  writeClientAppState,
} from "./application-state.js";
import { getBrowserTabId } from "./browser-tab-id.js";
import { BuilderDsiGate } from "./BuilderDsiGate.js";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog.js";
import { DesignSystemArtifactView } from "./DesignSystemArtifactView.js";
import {
  DesignSystemWorkspaceView,
  type DesignSystemWorkspaceLabels,
} from "./DesignSystemWorkspaceView.js";
import {
  actionErrorMessage,
  callAction,
  useActionQuery,
} from "./use-action.js";
import { useSession } from "./use-session.js";

export interface DesignSystemWorkspaceReturn {
  id: string;
  ownerApp: "design" | "slides";
  revision: number;
}

export interface OpenDesignSystemWorkspace {
  systemId: string;
  originId?: string;
  onUse?: (system: DesignSystemWorkspaceReturn) => void | Promise<void>;
}

interface WorkspaceHost {
  labels: DesignSystemWorkspaceLabels;
  ownerApp: "design" | "slides";
  renderSources: (systemId: string, onDone: () => void) => ReactNode;
}

const WorkspaceContext = createContext<{
  open: (input: OpenDesignSystemWorkspace) => void;
  active: boolean;
  host: WorkspaceHost;
  registerOrigin: (
    id: string,
    onUse: NonNullable<OpenDesignSystemWorkspace["onUse"]>,
  ) => () => void;
} | null>(null);

export function useDesignSystemWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("DesignSystemWorkspaceProvider is required");
  return context;
}

export function useDesignSystemWorkspaceOrigin(
  id: string,
  onUse: NonNullable<OpenDesignSystemWorkspace["onUse"]>,
) {
  const { registerOrigin, open } = useDesignSystemWorkspace();
  const latest = useRef(onUse);
  latest.current = onUse;
  useEffect(
    () => registerOrigin(id, (system) => latest.current(system)),
    [registerOrigin, id],
  );
  return useCallback(
    (systemId: string) => open({ systemId, originId: id }),
    [open, id],
  );
}

export function DesignSystemWorkspaceProvider({
  children,
  labels,
  ownerApp,
  renderSources,
}: WorkspaceHost & { children: ReactNode }) {
  const [storedRequest, setRequest] =
    useState<OpenDesignSystemWorkspace | null>(null);
  const { session } = useSession();
  const storageKey = `design-system-return:${ownerApp}:${session?.email ?? "guest"}:${session?.orgId ?? "personal"}`;
  const requestIdentity = useRef<string | undefined>(undefined);
  const request = requestIdentity.current === storageKey ? storedRequest : null;
  const origins = useRef(
    new Map<string, NonNullable<OpenDesignSystemWorkspace["onUse"]>>(),
  );
  const registerOrigin = useCallback(
    (id: string, callback: NonNullable<OpenDesignSystemWorkspace["onUse"]>) => {
      origins.current.set(id, callback);
      return () => {
        if (origins.current.get(id) === callback) origins.current.delete(id);
      };
    },
    [],
  );
  useEffect(() => {
    requestIdentity.current = storageKey;
    setRequest(null);
    const saved = sessionStorage.getItem(storageKey);
    if (!saved) return;
    try {
      const input = JSON.parse(saved);
      if (
        typeof input.systemId !== "string" ||
        typeof input.originId !== "string"
      )
        throw new Error(labels.loadFailed);
      setRequest(input);
    } catch (cause) {
      console.error(cause);
    }
  }, [storageKey, labels.loadFailed]);
  const open = useCallback(
    (input: OpenDesignSystemWorkspace) => {
      requestIdentity.current = storageKey;
      if (input.originId)
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            systemId: input.systemId,
            originId: input.originId,
          }),
        );
      setRequest(input);
    },
    [storageKey],
  );
  const close = () => {
    sessionStorage.removeItem(storageKey);
    setRequest(null);
  };
  const host = useMemo(
    () => ({ labels, ownerApp, renderSources }),
    [labels, ownerApp, renderSources],
  );
  return (
    <WorkspaceContext.Provider
      value={{ open, active: Boolean(request), host, registerOrigin }}
    >
      <AgentChatActivityProvider active={!request}>
        {children}
      </AgentChatActivityProvider>
      <Dialog
        open={Boolean(request)}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <DialogContent
          hideClose
          aria-describedby={undefined}
          className="inset-0 flex h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-none"
        >
          <DialogTitle className="sr-only">{labels.canvas}</DialogTitle>
          {request ? (
            <DesignSystemWorkspace
              key={request.systemId}
              systemId={request.systemId}
              onBack={close}
              onUse={
                request.originId
                  ? async (system) => {
                      const apply = origins.current.get(request.originId!);
                      if (!apply) throw new Error(labels.loadFailed);
                      await apply(system);
                    }
                  : request.onUse
              }
              onUsed={close}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </WorkspaceContext.Provider>
  );
}

export function designSystemTargetContext(
  snapshot: DesignSystemWorkspaceSnapshot,
  target: DesignSystemArtifact,
): AgentChatContextItem {
  const context: DesignSystemTargetContext = {
    ownerApp: snapshot.workspace!.ownerApp,
    systemId: snapshot.id,
    targetId: target.id,
    expectedRevision: target.revision,
  };
  return {
    key: `system-target:${snapshot.id}`,
    title: target.name,
    context: `Design system target: ${JSON.stringify(context)}\nRead get-design-system-artifact for this target before editing. ${snapshot.workspace?.runtime === "builder" ? `Use run-design-system-agent with this target ID and Builder expectedRevision ${JSON.stringify(snapshot.workspace.builder?.revision)}. Builder owns the files; do not write local substitute artifacts.` : "Use write-design-system-artifact with this target ID and target revision."} Keep the existing system and unrelated artifacts.`,
    status: "ready",
  };
}

interface DesignSystemWorkspaceProps {
  systemId: string;
  onBack: () => void;
  onUse?: OpenDesignSystemWorkspace["onUse"];
  onUsed?: () => void;
}

export function DesignSystemWorkspace(props: DesignSystemWorkspaceProps) {
  return (
    <BuilderDsiGate onBack={props.onBack}>
      <DesignSystemWorkspaceContent {...props} />
    </BuilderDsiGate>
  );
}

function DesignSystemWorkspaceContent({
  systemId,
  onBack,
  onUse,
  onUsed,
}: DesignSystemWorkspaceProps) {
  const { host } = useDesignSystemWorkspace();
  const { labels } = host;
  const queryClient = useQueryClient();
  const query = useActionQuery<DesignSystemWorkspaceSnapshot>(
    "get-design-system-workspace",
    { id: systemId },
    {
      refetchInterval: (query) => {
        const workspace = query.state.data?.workspace;
        return workspace?.runtime === "builder" &&
          (workspace.builder?.status === "preparing" ||
            workspace.builder?.workspaceStatus === "working" ||
            workspace.run?.status === "queued" ||
            workspace.run?.status === "running")
          ? 2500
          : false;
      },
    },
  );
  const snapshot = query.data;
  const { refetch } = query;
  const workspace = snapshot?.workspace;
  const workspaceOwnerApp = workspace?.ownerApp;
  const workspaceConversationId = workspace?.conversationId;
  const [selection, setSelection] = useState<{
    systemId: string;
    targetId: string | null;
  } | null>(null);
  const [error, setError] = useState<string>();
  const [addingSources, setAddingSources] = useState(false);
  const [using, setUsing] = useState(false);
  const [readyThread, setReadyThread] = useState<string>();
  const kickoffInFlight = useRef(false);
  const kickoffAttempted = useRef<string | undefined>(undefined);
  const runWrites = useRef<Promise<unknown>>(Promise.resolve());
  const stateWrites = useRef<Promise<unknown>>(Promise.resolve());
  const resumeAttempted = useRef(false);
  useEffect(() => {
    if (!snapshot?.canEdit || snapshot.workspace || resumeAttempted.current)
      return;
    resumeAttempted.current = true;
    void callAction("resume-design-system-authoring", { id: systemId })
      .then(() => refetch())
      .catch((cause) =>
        setError(actionErrorMessage(cause) ?? labels.loadFailed),
      );
  }, [snapshot, systemId, refetch, labels.loadFailed]);
  const usePending = useRef(false);
  const publicationRequests = useRef(new Map<string, string>());
  const selectionWrites = useRef<Promise<void>>(Promise.resolve());
  const selectionVersion = useRef(0);
  const selectedTargetId =
    selection?.systemId === systemId
      ? selection.targetId
      : (workspace?.selectedTargetId ?? null);
  const target = workspace?.artifacts.find(
    (artifact) => artifact.id === selectedTargetId,
  );
  const contextItems = useMemo(
    () =>
      snapshot && workspace
        ? [
            ...(target ? [designSystemTargetContext(snapshot, target)] : []),
            ...workspace.sources
              .filter((source) => !source.excluded)
              .map(
                (source): AgentChatContextItem => ({
                  key: `system-source:${source.id}`,
                  title: source.kind === "file" ? source.name : source.url,
                  context: `Design system source: ${JSON.stringify({ ownerApp: workspace.ownerApp, systemId, sourceId: source.id, kind: source.kind, status: source.status })}. Inspect get-design-system-workspace to read its evidence or extraction error.`,
                  status:
                    source.status === "reading"
                      ? "pending"
                      : source.error
                        ? "error"
                        : "ready",
                  statusMessage:
                    source.error?.message ??
                    (source.status === "reading"
                      ? labels.readingSources
                      : source.status === "staged"
                        ? labels.awaitingDirection
                        : undefined),
                  removable: false,
                  blocksSubmission: false,
                }),
              ),
          ]
        : [],
    [snapshot, workspace, target, systemId, labels],
  );
  const scope = useMemo(
    () =>
      workspace
        ? {
            type: "design-system",
            id: workspace.conversationScope,
            label: snapshot!.title,
            contextKey: `design-system:${workspace.ownerApp}:${systemId}`,
            contextVersion: `${workspace.revision}:${target?.id ?? ""}:${target?.revision ?? ""}`,
            context: `Author the existing ${workspace.ownerApp} design system ${systemId}. ${workspace.runtime === "builder" ? "Read get-design-system-workspace, then send the user's direction through run-design-system-agent with one stable requestId per turn. All generation and refinement use the same Builder DSI session. Read the returned live progress and artifact bodies; do not author substitute files with write-design-system-artifact. Submission is not completion. If the outcome is unknown, read the existing session instead of submitting again. Publishing is a separate user action." : "Read get-design-system-workspace and use write-design-system-artifact for persisted foundations, standalone component HTML and usage rules."} Sources, source errors and prior decisions belong to this system. Never replace artifacts with canned examples or claim processing before it runs.`,
          }
        : null,
    [workspace, snapshot, systemId, target],
  );

  useEffect(() => {
    if (!workspaceOwnerApp || !workspaceConversationId) return;
    let current = true;
    stateWrites.current = stateWrites.current
      .catch(() => {})
      .then(() =>
        writeClientAppState(
          "design-system-selection",
          {
            ownerApp: workspaceOwnerApp,
            systemId,
            conversationId: workspaceConversationId,
            selectedTargetId,
            expectedRevision: target?.revision ?? null,
          },
          { requestSource: getBrowserTabId() },
        ),
      )
      .catch((cause) => {
        if (current) setError(actionErrorMessage(cause) ?? labels.loadFailed);
      });
    return () => {
      current = false;
    };
  }, [
    systemId,
    workspaceOwnerApp,
    workspaceConversationId,
    selectedTargetId,
    target?.revision,
    labels.loadFailed,
  ]);

  useEffect(
    () => () => {
      void stateWrites.current
        .finally(() =>
          deleteClientAppState("design-system-selection", {
            requestSource: getBrowserTabId(),
            keepalive: true,
          }),
        )
        .catch(console.error);
    },
    [systemId],
  );

  const dispatchKickoff = useCallback(async () => {
    if (
      !workspace ||
      readyThread !== workspace.conversationId ||
      !snapshot?.canEdit ||
      kickoffInFlight.current
    )
      return;
    kickoffInFlight.current = true;
    let claimId: string | null = null;
    try {
      const claim = await callAction<{
        shouldDispatch: boolean;
        conversationId: string;
        requestId: string;
        claimId: string | null;
      }>("claim-design-system-kickoff", { id: systemId });
      if (!claim.shouldDispatch || !claim.claimId) return;
      claimId = claim.claimId;
      const delivery = await sendToAgentChatAndConfirm({
        message:
          workspace.intent === "fresh" && !workspace.sources.length
            ? labels.freshKickoff
            : labels.referencesKickoff,
        context: `Design system ${systemId}, owner ${workspace.ownerApp}. First read get-design-system-workspace. ${workspace.intent === "fresh" && !workspace.sources.length ? "Ask one concise question about the user's desired direction, then wait. Do not generate preset artifacts." : workspace.runtime === "builder" ? `Call run-design-system-agent for this system with requestId ${JSON.stringify(claim.requestId)} and a prompt to create its design system from the complete staged reference batch. The action prepares the sources and starts Builder DSI; report its actual progress or source failures. Preserve the same session for later turns. Do not use write-design-system-artifact or claim that submission finished generation.` : "Read each staged source with read-design-system-source. Preserve existing artifacts and sources. Generate foundations, standalone component HTML and usage rules through write-design-system-artifact using each target's revision."}`,
        chatTarget: "local",
        tabId: claim.conversationId,
        submit: true,
        openSidebar: false,
        submitMessageId: claim.requestId,
        turnId: claim.requestId,
      });
      await callAction("complete-design-system-kickoff", {
        id: systemId,
        claimId,
        status: delivery.delivered ? "delivered" : "failed",
        ...(!delivery.delivered
          ? { error: delivery.reason ?? labels.loadFailed }
          : {}),
      });
      if (!delivery.delivered)
        throw new Error(delivery.reason ?? labels.loadFailed);
      await queryClient.invalidateQueries({
        queryKey: ["action", "get-design-system-workspace"],
      });
    } catch (cause) {
      setError(actionErrorMessage(cause) ?? labels.loadFailed);
    } finally {
      kickoffInFlight.current = false;
    }
  }, [
    workspace,
    readyThread,
    snapshot?.canEdit,
    systemId,
    labels,
    queryClient,
  ]);
  useEffect(() => {
    const requestId = workspace?.kickoff?.requestId;
    if (
      !requestId ||
      readyThread !== workspace.conversationId ||
      kickoffAttempted.current === requestId
    )
      return;
    kickoffAttempted.current = requestId;
    void dispatchKickoff();
  }, [
    workspace?.kickoff?.requestId,
    workspace?.conversationId,
    readyThread,
    dispatchKickoff,
  ]);
  const kickoffLease = workspace?.kickoff;
  useEffect(() => {
    const lease = kickoffLease;
    if (
      lease?.status !== "claimed" ||
      !lease.leaseUntil ||
      readyThread !== workspace?.conversationId
    )
      return;
    const timer = window.setTimeout(
      () => {
        void dispatchKickoff();
      },
      Math.max(0, lease.leaseUntil - Date.now()) + 100,
    );
    return () => window.clearTimeout(timer);
  }, [kickoffLease, workspace?.conversationId, readyThread, dispatchKickoff]);
  const onRunStateChange = useCallback(
    (state: { runId: string | null; status: string | null }) => {
      if (!state.runId) return;
      if (workspace?.runtime === "builder") {
        void queryClient.invalidateQueries({
          queryKey: ["action", "get-design-system-workspace", { id: systemId }],
        });
        return;
      }
      runWrites.current = runWrites.current
        .catch(() => {})
        .then(async () => {
          await callAction("bind-design-system-run", {
            id: systemId,
            runId: state.runId,
          });
          await queryClient.invalidateQueries({
            queryKey: [
              "action",
              "get-design-system-workspace",
              { id: systemId },
            ],
          });
        })
        .catch((cause) =>
          setError(actionErrorMessage(cause) ?? labels.loadFailed),
        );
    },
    [systemId, queryClient, labels.loadFailed, workspace?.runtime],
  );

  const select = (artifact: DesignSystemArtifact | null) => {
    setSelection({ systemId, targetId: artifact?.id ?? null });
    setError(undefined);
    if (!snapshot?.canEdit) return;
    const version = ++selectionVersion.current;
    const write = selectionWrites.current.then(async () => {
      const latest = await callAction<DesignSystemWorkspaceSnapshot>(
        "get-design-system-workspace",
        { id: systemId },
        { method: "GET" },
      );
      if (!latest.workspace) throw new Error(labels.loadFailed);
      await callAction("update-design-system-workspace", {
        id: systemId,
        expectedRevision: latest.workspace.revision,
        operationId: crypto.randomUUID(),
        selectedTargetId: artifact?.id ?? null,
      });
      await queryClient.invalidateQueries({
        queryKey: ["action", "get-design-system-workspace", { id: systemId }],
      });
    });
    selectionWrites.current = write.catch((cause) => {
      if (selectionVersion.current === version)
        setError(actionErrorMessage(cause) ?? labels.loadFailed);
    });
  };
  const use = async () => {
    if (usePending.current || !onUse || !workspace) return;
    usePending.current = true;
    setUsing(true);
    setError(undefined);
    try {
      await selectionWrites.current;
      let latest = await callAction<DesignSystemWorkspaceSnapshot>(
        "get-design-system-workspace",
        { id: systemId },
        { method: "GET" },
      );
      if (!latest.workspace?.artifacts.length)
        throw new Error(labels.emptySection);
      if (latest.workspace.runtime === "builder") {
        const revision = latest.workspace.builder?.revision;
        if ((!latest.canUse && !latest.canPublish) || !revision)
          throw new Error(labels.needsAttention);
        if (latest.workspace.builder?.publication?.revision !== revision) {
          const requestId =
            publicationRequests.current.get(revision) ?? crypto.randomUUID();
          publicationRequests.current.set(revision, requestId);
          latest = await callAction<DesignSystemWorkspaceSnapshot>(
            "publish-design-system",
            { id: systemId, requestId, expectedRevision: revision },
          );
        }
        const publication = latest.workspace?.builder?.publication;
        if (
          !publication ||
          publication.revision !== revision ||
          publication.published < 1 ||
          publication.contentRevision !== latest.workspace?.contentRevision
        )
          throw new Error(labels.loadFailed);
      }
      if (!latest.workspace) throw new Error(labels.loadFailed);
      await onUse({
        id: systemId,
        ownerApp: latest.workspace.ownerApp,
        revision: latest.workspace.contentRevision,
      });
      onUsed?.();
    } catch (cause) {
      usePending.current = false;
      setUsing(false);
      setError(actionErrorMessage(cause) ?? labels.loadFailed);
    }
  };
  const sourceAction = async (
    sourceId: string,
    action: "retry" | "exclude" | "restore",
  ) => {
    setError(undefined);
    try {
      if (action === "retry") {
        if (!workspace || readyThread !== workspace.conversationId)
          throw new Error(labels.preparing);
        const requestId = crypto.randomUUID();
        const result = await sendToAgentChatAndConfirm({
          message: labels.referencesKickoff,
          context: `Retry only source ${sourceId} in design system ${systemId}. Read read-design-system-source, persist its actual evidence/status/error through update-design-system-workspace, preserve all other source entries and saved artifacts. Do not claim success on failure.`,
          tabId: workspace.conversationId,
          submitMessageId: requestId,
          turnId: requestId,
          chatTarget: "local",
          submit: true,
          openSidebar: false,
        });
        if (!result.delivered)
          throw new Error(result.reason ?? labels.loadFailed);
      } else {
        const latest = await callAction<DesignSystemWorkspaceSnapshot>(
          "get-design-system-workspace",
          { id: systemId },
          { method: "GET" },
        );
        if (!latest.workspace) throw new Error(labels.loadFailed);
        await callAction("update-design-system-workspace", {
          id: systemId,
          expectedRevision: latest.workspace.revision,
          operationId: crypto.randomUUID(),
          sourceExclusions: [{ id: sourceId, excluded: action === "exclude" }],
        });
      }
      await queryClient.invalidateQueries({
        queryKey: ["action", "get-design-system-workspace"],
      });
    } catch (cause) {
      setError(actionErrorMessage(cause) ?? labels.loadFailed);
    }
  };
  return (
    <AgentChatActivityProvider active>
      <DesignSystemWorkspaceView
        snapshot={snapshot}
        labels={labels}
        selectedTargetId={selectedTargetId}
        pending={query.isLoading}
        using={using}
        error={
          error ??
          workspace?.kickoff?.error ??
          (query.error
            ? (actionErrorMessage(query.error) ?? labels.loadFailed)
            : snapshot && !workspace
              ? labels.loadFailed
              : undefined)
        }
        onBack={onBack}
        onRetry={() => {
          setError(undefined);
          void query.refetch();
          void dispatchKickoff();
        }}
        onSelect={select}
        onSourceAction={(id, action) => {
          void sourceAction(id, action);
        }}
        onAddSources={() => setAddingSources(true)}
        onUse={
          onUse
            ? () => {
                void use();
              }
            : undefined
        }
        sourceCollector={
          addingSources
            ? host.renderSources(systemId, () => {
                setAddingSources(false);
                void query.refetch();
              })
            : undefined
        }
        renderArtifact={(artifact, onSelect) => (
          <DesignSystemArtifactView
            systemId={systemId}
            artifact={artifact}
            labels={labels}
            selected={selectedTargetId === artifact.id}
            onSelect={onSelect}
          />
        )}
        chat={
          workspace ? (
            <AgentChatSurface
              mode="panel"
              className="h-full"
              chatOnly
              showHeader={false}
              showTabBar={false}
              showPageHeader={false}
              showPageNewChatButton={false}
              storageKey={`design-system:${workspace.ownerApp}:${systemId}`}
              fixedThreadId={workspace.conversationId}
              isolateHistoryByScope
              scope={scope}
              threadUrlSync={false}
              onThreadReady={setReadyThread}
              onRunStateChange={onRunStateChange}
              composerContextItems={contextItems}
              composerContextThreadId={workspace.conversationId}
              onRemoveComposerContextItem={(key) => {
                if (key === `system-target:${systemId}`) select(null);
              }}
              emptyStateText={labels.empty}
              dynamicSuggestions={false}
              composerDisabled={!snapshot?.canEdit}
            />
          ) : (
            <div className="flex h-full flex-col gap-4 p-4">
              <Skeleton className="h-16 w-3/4" />
              <Skeleton className="h-24 w-full" />
            </div>
          )
        }
      />
    </AgentChatActivityProvider>
  );
}
