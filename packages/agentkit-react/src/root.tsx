import {
  createAgentKitHttpTransport,
  type AgentKitHttpTransportOptions,
} from "@agent-native/agentkit-adapters";
import {
  createAgentKitClient,
  type AgentKitClient,
  type AgentKitClientOptions,
  type AgentKitController,
  type AgentThreadLease,
} from "@agent-native/agentkit-client";
import type {
  AgentConnectionRequest,
  AgentConnectionResponse,
  AgentObjectReference,
  AgentThread,
  AgentTransport,
  ThreadId,
} from "@agent-native/agentkit-protocol";
import { useEffect, useMemo, useRef, type ReactNode } from "react";

import {
  AgentKitProvider,
  type AgentKitLabels,
  type AgentKitRegistry,
  type AgentKitRenderFailure,
  type AgentKitSlots,
} from "./context.js";

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
      /** A host-owned controller. AgentKit never disposes it. */
      controller: AgentKitController;
      transport?: never;
      clientOptions?: never;
      endpoint?: never;
      http?: never;
    }
  | {
      /** A host-owned transport used by one AgentKit-managed controller. */
      controller?: never;
      transport: AgentTransport;
      clientOptions?: AgentKitManagedClientOptions;
      endpoint?: never;
      http?: never;
    }
  | {
      /** HTTP endpoint used by an AgentKit-managed transport and controller. */
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
  /** Navigates or otherwise activates a newly forked thread. */
  onThreadForked?: (thread: AgentThread) => void;
  onConnectionRequest?: (
    request: AgentConnectionRequest,
  ) => Promise<AgentConnectionResponse>;
  /** Reports custom renderer failures without exposing internals to users. */
  onRenderError?: (failure: AgentKitRenderFailure) => void;
  onClientEffect?: (effect: {
    type: "client.effect" | "client.deeplink";
    name: string;
    data?: Record<string, unknown>;
  }) => void;
  /** Loads the thread projection on mount and whenever `threadId` changes. */
  load?: "auto" | "manual";
  /** Observes an initial load failure in addition to the rendered error state. */
  onLoadError?: (error: unknown) => void;
}

export type AgentKitRootProps = AgentKitRootBaseProps & AgentKitClientSource;

/**
 * Owns AgentKit's controller lifecycle without imposing a visual shell.
 * Use this for custom products that compose the headless hooks directly.
 */
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
  onConnectionRequest,
  onRenderError,
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
  const httpFetch = http?.fetch;
  const httpHeaders = http?.headers;
  const httpCreateCorrelationId = http?.createCorrelationId;
  const httpSignal = http?.signal;
  const resolvedTransport = useMemo(
    () =>
      transport ??
      (endpoint
        ? createAgentKitHttpTransport({
            baseUrl: endpoint,
            fetch: httpFetch,
            headers: httpHeaders,
            createCorrelationId: httpCreateCorrelationId,
            signal: httpSignal,
          })
        : undefined),
    [
      endpoint,
      httpCreateCorrelationId,
      httpFetch,
      httpHeaders,
      httpSignal,
      transport,
    ],
  );
  const createId = clientOptions?.createId;
  const now = clientOptions?.now;
  const reconnectAttempts = clientOptions?.reconnect?.attempts;
  const reconnectDelay = clientOptions?.reconnect?.delayMs;
  const onError = clientOptions?.onError;
  const upload = clientOptions?.upload;
  const transportOwnership = endpoint
    ? "owned"
    : clientOptions?.transportOwnership;
  const retainActiveRunsOnThreadRelease =
    clientOptions?.retainActiveRunsOnThreadRelease;
  const managedClient = useMemo(
    () =>
      controller
        ? undefined
        : createAgentKitClient({
            transport: resolvedTransport as AgentTransport,
            transportOwnership,
            createId,
            now,
            reconnect: {
              attempts: reconnectAttempts,
              delayMs: reconnectDelay,
            },
            onError,
            retainActiveRunsOnThreadRelease,
            upload,
          }),
    [
      controller,
      createId,
      now,
      onError,
      reconnectAttempts,
      reconnectDelay,
      resolvedTransport,
      retainActiveRunsOnThreadRelease,
      transportOwnership,
      upload,
    ],
  );
  const resolvedController = controller ?? managedClient;
  if (!resolvedController) {
    throw new Error(
      "AgentKitRoot requires a controller, transport, or HTTP endpoint.",
    );
  }
  const activeLoadLease = useRef<ActiveThreadLeaseScope | undefined>(undefined);
  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;

  useEffect(() => {
    if (load !== "auto") return;
    const lease: ActiveThreadLeaseScope = {
      controller: resolvedController,
      threadId,
      released: false,
    };
    activeLoadLease.current = lease;
    // openThread loads the projection, resumes active runs, and owns the
    // subscriptions until this client/thread scope releases its lease.
    void resolvedController
      .openThread(threadId)
      .then((threadLease) => {
        lease.thread = threadLease;
        if (lease.released || activeLoadLease.current !== lease) {
          threadLease.release();
        }
      })
      .catch((error) => {
        if (!lease.released && activeLoadLease.current === lease) {
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
        // A caller-owned client can finish an obsolete load after the current
        // thread succeeded. Refresh the active projection so that stale global
        // connection state cannot replace the current thread's recovered state.
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
  }, [load, resolvedController, threadId]);

  useEffect(() => {
    if (!managedClient) return;
    mountedManagedClients.set(
      managedClient,
      (mountedManagedClients.get(managedClient) ?? 0) + 1,
    );
    return () => {
      const remaining = (mountedManagedClients.get(managedClient) ?? 1) - 1;
      mountedManagedClients.set(managedClient, remaining);
      // Strict Mode replays effects in the same task. Deferring disposal lets
      // the replacement setup retain the same client while real unmounts still
      // release it deterministically.
      queueMicrotask(() => {
        if ((mountedManagedClients.get(managedClient) ?? 0) > 0) return;
        mountedManagedClients.delete(managedClient);
        managedClient.dispose();
      });
    };
  }, [managedClient]);

  return (
    <AgentKitProvider
      controller={resolvedController}
      threadId={threadId}
      slots={slots}
      registry={registry}
      labels={labels}
      onOpenObject={onOpenObject}
      onThreadForked={onThreadForked}
      onConnectionRequest={onConnectionRequest}
      onRenderError={onRenderError}
      onClientEffect={onClientEffect}
    >
      {children}
    </AgentKitProvider>
  );
}
