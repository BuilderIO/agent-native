import {
  createAgentKitClient,
  type AgentKitClient,
  type AgentKitClientOptions,
  type AgentKitController,
  type AgentThreadLease,
} from "@agent-native/agentkit/client";
import {
  createAgentKitHttpTransport,
  type AgentKitHttpTransportOptions,
} from "@agent-native/agentkit/http";
import type {
  AgentConnectionRequest,
  AgentConnectionResponse,
  AgentObjectReference,
  AgentThread,
  AgentTransport,
  ThreadId,
} from "@agent-native/agentkit/protocol";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  AgentKitProvider,
  type AgentKitLabels,
  type AgentKitBranchNavigation,
  type AgentKitCopyMessageHandler,
  type AgentKitFeedbackReportBuilder,
  type AgentKitRegistry,
  type AgentKitRenderFailure,
  type AgentKitRunUsageLoader,
  type AgentKitSlots,
  type AgentKitThreadLoadState,
} from "./context.js";
import type { AgentChatDataChartLayout } from "./data-chart-layout.js";
import type { AgentMessageContentOrderResolver } from "./message-content-order.js";
import type { AgentChatWorkedForRowLayout } from "./transcript-layout.js";

const mountedManagedClients = new WeakMap<AgentKitClient, number>();

interface ActiveThreadLeaseScope {
  controller: AgentKitController;
  threadId: ThreadId;
  released: boolean;
  thread?: AgentThreadLease;
}

export interface AgentKitManagedClientOptions extends Omit<
  AgentKitClientOptions,
  "transport"
> {}

export type AgentKitClientSource =
  | {
      controller: AgentKitController;
      transport?: never;
      clientOptions?: never;
      endpoint?: never;
      http?: never;
    }
  | {
      controller?: never;
      transport: AgentTransport;
      clientOptions?: AgentKitManagedClientOptions;
      endpoint?: never;
      http?: never;
    }
  | {
      endpoint: string;
      http?: Omit<AgentKitHttpTransportOptions, "baseUrl">;
      controller?: never;
      transport?: never;
      clientOptions?: AgentKitManagedClientOptions;
    };

export interface AgentKitRootBaseProps {
  threadId: ThreadId;
  children: ReactNode;
  slots?: AgentKitSlots;
  registry?: AgentKitRegistry;
  labels?: Partial<AgentKitLabels>;
  onOpenObject?: (object: AgentObjectReference) => void;
  onThreadForked?: (thread: AgentThread) => void;
  branchNavigation?: AgentKitBranchNavigation;
  onCopyMessage?: AgentKitCopyMessageHandler;
  buildFeedbackReport?: AgentKitFeedbackReportBuilder;
  loadRunUsage?: AgentKitRunUsageLoader;
  onConnectionRequest?: (
    request: AgentConnectionRequest,
  ) => Promise<AgentConnectionResponse>;
  onRenderError?: (failure: AgentKitRenderFailure) => void;
  resolveMessageContentOrder?: AgentMessageContentOrderResolver;
  workedForRowLayout?: AgentChatWorkedForRowLayout;
  dataChartLayout?: AgentChatDataChartLayout;
  formatWorkedForDuration?: (durationMs: number) => string;
  /** Display name for a model id in run details; the id shows without it. */
  formatModelName?: (model: string) => string;
  onClientEffect?: (effect: {
    type: "client.effect" | "client.deeplink";
    name: string;
    data?: Record<string, unknown>;
  }) => void;
  load?: "auto" | "manual";
  onLoadError?: (error: unknown) => void;
}

export type AgentKitRootProps = AgentKitRootBaseProps & AgentKitClientSource;

/** A host callback the client was built around, read at call time. */
function latestCallback<T>(callback: T | undefined, name: string): T {
  if (callback === undefined) {
    throw new Error(
      `AgentKitRoot ${name} was removed after the client was created.`,
    );
  }
  return callback;
}

export function AgentKitRoot({
  controller,
  transport,
  endpoint,
  http,
  clientOptions,
  threadId,
  slots,
  registry,
  labels,
  onOpenObject,
  onThreadForked,
  branchNavigation,
  onCopyMessage,
  buildFeedbackReport,
  loadRunUsage,
  onConnectionRequest,
  onRenderError,
  resolveMessageContentOrder,
  workedForRowLayout,
  dataChartLayout,
  formatWorkedForDuration,
  formatModelName,
  onClientEffect,
  load = "auto",
  onLoadError,
  children,
}: AgentKitRootProps) {
  const sourceCount =
    Number(controller !== undefined) +
    Number(transport !== undefined) +
    Number(endpoint !== undefined);
  if (sourceCount !== 1) {
    throw new Error(
      "AgentKitRoot requires exactly one controller, transport, or HTTP endpoint.",
    );
  }
  // Hosts pass these inline. The client and its live streams are keyed on the
  // transport and structural options only; callbacks are read through refs.
  const latest = useRef({ http, clientOptions });
  latest.current = { http, clientOptions };
  const hasHttpFetch = http?.fetch !== undefined;
  const hasHttpHeaders = http?.headers !== undefined;
  const hasHttpCorrelationId = http?.createCorrelationId !== undefined;
  const httpSignal = http?.signal;
  const resolvedTransport = useMemo(
    () =>
      transport ??
      (endpoint
        ? createAgentKitHttpTransport({
            baseUrl: endpoint,
            fetch: hasHttpFetch
              ? (input, init) =>
                  latestCallback(latest.current.http?.fetch, "http.fetch")(
                    input,
                    init,
                  )
              : undefined,
            headers: hasHttpHeaders
              ? () => {
                  const headers = latest.current.http?.headers ?? {};
                  return typeof headers === "function" ? headers() : headers;
                }
              : undefined,
            createCorrelationId: hasHttpCorrelationId
              ? () =>
                  latestCallback(
                    latest.current.http?.createCorrelationId,
                    "http.createCorrelationId",
                  )()
              : undefined,
            signal: httpSignal,
          })
        : undefined),
    [
      endpoint,
      hasHttpCorrelationId,
      hasHttpFetch,
      hasHttpHeaders,
      httpSignal,
      transport,
    ],
  );
  const hasCreateId = clientOptions?.createId !== undefined;
  const hasNow = clientOptions?.now !== undefined;
  const reconnectAttempts = clientOptions?.reconnect?.attempts;
  const hasReconnectDelay = clientOptions?.reconnect?.delayMs !== undefined;
  const aiSetupReadiness = clientOptions?.aiSetupReadiness;
  const hasOnError = clientOptions?.onError !== undefined;
  const hasOnIntegrityReport = clientOptions?.onIntegrityReport !== undefined;
  const hasUpload = clientOptions?.upload !== undefined;
  const transportOwnership = endpoint
    ? "owned"
    : clientOptions?.transportOwnership;
  const retainActiveRunsOnThreadRelease =
    clientOptions?.retainActiveRunsOnThreadRelease;
  const managedClient = useMemo(() => {
    if (controller) return undefined;
    const options = () => latest.current.clientOptions;
    return createAgentKitClient({
      transport: resolvedTransport as AgentTransport,
      ...(aiSetupReadiness === undefined ? {} : { aiSetupReadiness }),
      ...(transportOwnership === undefined ? {} : { transportOwnership }),
      ...(hasCreateId
        ? {
            createId: (prefix) =>
              latestCallback(
                options()?.createId,
                "clientOptions.createId",
              )(prefix),
          }
        : {}),
      ...(hasNow
        ? {
            now: () => latestCallback(options()?.now, "clientOptions.now")(),
          }
        : {}),
      reconnect: {
        ...(reconnectAttempts === undefined
          ? {}
          : { attempts: reconnectAttempts }),
        ...(hasReconnectDelay
          ? {
              delayMs: (attempt) =>
                latestCallback(
                  options()?.reconnect?.delayMs,
                  "clientOptions.reconnect.delayMs",
                )(attempt),
            }
          : {}),
      },
      ...(hasOnError
        ? { onError: (error) => options()?.onError?.(error) }
        : {}),
      ...(hasOnIntegrityReport
        ? {
            onIntegrityReport: (report) =>
              options()?.onIntegrityReport?.(report),
          }
        : {}),
      ...(retainActiveRunsOnThreadRelease === undefined
        ? {}
        : { retainActiveRunsOnThreadRelease }),
      ...(hasUpload
        ? {
            upload: (target, file, context) =>
              latestCallback(options()?.upload, "clientOptions.upload")(
                target,
                file,
                context,
              ),
          }
        : {}),
    });
  }, [
    controller,
    aiSetupReadiness,
    hasCreateId,
    hasNow,
    hasOnError,
    hasOnIntegrityReport,
    hasReconnectDelay,
    hasUpload,
    reconnectAttempts,
    resolvedTransport,
    retainActiveRunsOnThreadRelease,
    transportOwnership,
  ]);
  const resolvedController = controller ?? managedClient;
  if (!resolvedController) {
    throw new Error(
      "AgentKitRoot requires a controller, transport, or HTTP endpoint.",
    );
  }
  const activeLoadLease = useRef<ActiveThreadLeaseScope | undefined>(undefined);
  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;
  const [threadLoadState, setThreadLoadState] = useState<
    AgentKitThreadLoadState & {
      controller: AgentKitController;
      attempt: number;
    }
  >();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const retryLoad = useCallback(
    () => setLoadAttempt((attempt) => attempt + 1),
    [],
  );

  useEffect(() => {
    if (load !== "auto") return;
    const lease: ActiveThreadLeaseScope = {
      controller: resolvedController,
      threadId,
      released: false,
    };
    activeLoadLease.current = lease;
    const settle = (status: AgentKitThreadLoadState["status"]) =>
      setThreadLoadState({
        controller: resolvedController,
        threadId,
        status,
        attempt: loadAttempt,
      });
    void resolvedController
      .openThread(threadId)
      .then((threadLease) => {
        lease.thread = threadLease;
        if (lease.released || activeLoadLease.current !== lease) {
          threadLease.release();
          return;
        }
        if (threadLease.threadFound === false) {
          settle("missing");
          const error = new Error(`Thread not found: ${threadId}`);
          Object.assign(error, { status: 404, code: "not_found" });
          onLoadErrorRef.current?.(error);
        } else {
          settle("found");
        }
      })
      .catch((error) => {
        if (!lease.released && activeLoadLease.current === lease) {
          settle("failed");
          onLoadErrorRef.current?.(error);
          return;
        }
        const active = activeLoadLease.current;
        if (
          !active ||
          active.released ||
          active.controller !== resolvedController
        ) {
          return;
        }
        void active.controller
          .loadThread(active.threadId)
          .catch((activeError) => {
            if (activeLoadLease.current === active && !active.released) {
              onLoadErrorRef.current?.(activeError);
            }
          });
      });
    return () => {
      lease.released = true;
      lease.thread?.release();
    };
  }, [load, loadAttempt, resolvedController, threadId]);

  useEffect(() => {
    if (!managedClient) return;
    mountedManagedClients.set(
      managedClient,
      (mountedManagedClients.get(managedClient) ?? 0) + 1,
    );
    return () => {
      const remaining = (mountedManagedClients.get(managedClient) ?? 1) - 1;
      mountedManagedClients.set(managedClient, remaining);
      queueMicrotask(() => {
        if ((mountedManagedClients.get(managedClient) ?? 0) > 0) return;
        mountedManagedClients.delete(managedClient);
        managedClient.dispose();
      });
    };
  }, [managedClient]);

  const threadLoad = useMemo<AgentKitThreadLoadState | undefined>(() => {
    if (load !== "auto") return undefined;
    if (
      !threadLoadState ||
      threadLoadState.controller !== resolvedController ||
      threadLoadState.threadId !== threadId ||
      threadLoadState.attempt !== loadAttempt
    ) {
      return { threadId, status: "pending" };
    }
    return threadLoadState.status === "failed"
      ? { threadId, status: "failed", retry: retryLoad }
      : { threadId, status: threadLoadState.status };
  }, [
    load,
    loadAttempt,
    resolvedController,
    retryLoad,
    threadId,
    threadLoadState,
  ]);

  return (
    <AgentKitProvider
      controller={resolvedController}
      threadLoad={threadLoad}
      threadId={threadId}
      slots={slots}
      registry={registry}
      labels={labels}
      onOpenObject={onOpenObject}
      onThreadForked={onThreadForked}
      branchNavigation={branchNavigation}
      onCopyMessage={onCopyMessage}
      buildFeedbackReport={buildFeedbackReport}
      loadRunUsage={loadRunUsage}
      onConnectionRequest={onConnectionRequest}
      onRenderError={onRenderError}
      resolveMessageContentOrder={resolveMessageContentOrder}
      workedForRowLayout={workedForRowLayout}
      dataChartLayout={dataChartLayout}
      formatWorkedForDuration={formatWorkedForDuration}
      formatModelName={formatModelName}
      onClientEffect={onClientEffect}
    >
      {children}
    </AgentKitProvider>
  );
}
