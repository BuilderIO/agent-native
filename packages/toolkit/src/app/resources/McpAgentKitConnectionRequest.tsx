import type { AgentConnectionRequest } from "@agent-native/agentkit/protocol";
import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import {
  getWorkspaceConnectionProvider,
  workspaceProviderOAuthUrl,
} from "@agent-native/core/client/integrations";
import { openOAuthPopup } from "@agent-native/core/client/oauth-popup";
import {
  notifyMcpConnectionComplete,
  consumeMcpConnectionResume,
  saveMcpConnectionResume,
  type McpConnectionResumeRequest,
} from "@agent-native/core/client/resources/mcp-connection-resume";
import {
  getDefaultMcpIntegrations,
  navigateToMcpOAuthStart,
} from "@agent-native/core/client/resources/mcp-integration-catalog";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AgentConnectionRequestCard } from "../agentkit/react/components.js";
import {
  dispatchIntegrationsHref,
  useOrgSwitcherAppLinks,
} from "../org/workspace-app-links.js";
import { McpConnectionSuggestion } from "./McpConnectionSuggestion.js";

export interface McpAgentKitConnectionTarget {
  threadId: string;
  runId: string;
  requestId: string;
}

export interface McpAgentKitConnectionRequestCardProps {
  provider: string;
  detail?: string;
  reason?: AgentConnectionRequest["reason"];
  status?: AgentConnectionRequest["status"];
  appId?: string;
  source?: AgentConnectionRequest["source"];
  target: McpAgentKitConnectionTarget;
  onConnected: () => void | Promise<void>;
  onDeclined: () => void | Promise<void>;
  fallback?: ReactNode;
}

export function McpAgentKitConnectionRequestCard({
  provider,
  detail,
  reason,
  status = "requested",
  appId,
  source,
  target,
  onConnected,
  onDeclined,
  fallback = null,
}: McpAgentKitConnectionRequestCardProps) {
  const settledRef = useRef(false);
  const popupCleanupRef = useRef<(() => void) | null>(null);
  const [workspaceSetupOpened, setWorkspaceSetupOpened] = useState(false);
  const integrations = useMemo(() => getDefaultMcpIntegrations(), []);
  useEffect(
    () => () => {
      popupCleanupRef.current?.();
    },
    [],
  );
  const integration = integrations.find(
    (candidate) =>
      candidate.id.toLowerCase() === provider.trim().toLowerCase() ||
      candidate.provider.toLowerCase() === provider.trim().toLowerCase(),
  );
  const workspaceProvider =
    source?.kind === "workspace_connection" && source.id === provider
      ? getWorkspaceConnectionProvider(source.id)
      : null;
  const needsWorkspaceSetup =
    source?.kind === "workspace_connection" &&
    source.id === provider &&
    (reason === "grant" || !workspaceProvider?.oauth);
  const { apps: workspaceApps } = useOrgSwitcherAppLinks(needsWorkspaceSetup);
  useEffect(() => {
    if (status === "failed") setWorkspaceSetupOpened(false);
  }, [status]);
  const settle = async (callback: () => void | Promise<void>) => {
    if (settledRef.current) return;
    settledRef.current = true;
    try {
      await callback();
    } catch (error) {
      settledRef.current = false;
      throw error;
    }
  };
  if (source?.kind === "workspace_connection") {
    if (!workspaceProvider || !appId) return fallback;
    const request: AgentConnectionRequest = {
      id: target.requestId,
      provider,
      reason: reason ?? "connect",
      status,
      appId,
      detail,
      source,
    };
    if (reason === "grant" || !workspaceProvider.oauth) {
      return (
        <AgentConnectionRequestCard
          request={request}
          runId={target.runId}
          providerLabel={source.label}
          retry={workspaceSetupOpened}
          onConnect={() => {
            if (workspaceSetupOpened) return onConnected();
            window.open(
              dispatchIntegrationsHref(workspaceApps),
              "_blank",
              "noopener,noreferrer",
            );
            setWorkspaceSetupOpened(true);
          }}
        />
      );
    }
    return (
      <AgentConnectionRequestCard
        request={request}
        runId={target.runId}
        providerLabel={source.label}
        onConnect={() => {
          const popup = openOAuthPopup({ features: "width=640,height=760" });
          if (!popup) return false;
          return new Promise<void>((resolve, reject) => {
            let closeTimer: number | undefined;
            const cleanup = () => {
              window.removeEventListener("message", onMessage);
              if (closeTimer !== undefined) window.clearInterval(closeTimer);
              if (popupCleanupRef.current === cancel) {
                popupCleanupRef.current = null;
              }
            };
            const onMessage = (event: MessageEvent<unknown>) => {
              if (
                event.origin !== window.location.origin ||
                event.source !== popup ||
                typeof event.data !== "object" ||
                event.data === null ||
                !("type" in event.data) ||
                event.data.type !== "agent-native:workspace-connection-complete"
              ) {
                return;
              }
              cleanup();
              popup.close();
              notifyMcpConnectionComplete();
              void Promise.resolve().then(onConnected).then(resolve, reject);
            };
            const cancel = () => {
              cleanup();
              popup.close();
              resolve();
            };
            popupCleanupRef.current = cancel;
            window.addEventListener("message", onMessage);
            closeTimer = window.setInterval(() => {
              if (popup.closed) {
                cleanup();
                resolve();
              }
            }, 1_000);
            const returnUrl = new URL(
              agentNativePath("/_agent-native/oauth/popup"),
              window.location.href,
            );
            returnUrl.searchParams.set("complete", "workspace-connection");
            const basePath = appBasePath();
            const hasBasePath =
              basePath && returnUrl.pathname.startsWith(basePath + "/");
            const returnPath =
              (hasBasePath
                ? returnUrl.pathname.slice(basePath.length)
                : returnUrl.pathname) + returnUrl.search;
            try {
              popup.location.assign(
                workspaceProviderOAuthUrl(source.id, {
                  appId,
                  scope: "user",
                  returnPath,
                }),
              );
            } catch (error) {
              cleanup();
              popup.close();
              reject(error);
            }
          });
        }}
      />
    );
  }
  if (!integration) return fallback;
  return (
    <McpConnectionSuggestion
      text={detail ?? `Connect ${provider} to continue.`}
      contextText={detail}
      variant="response"
      requestedByAgent
      integrationId={integration.id}
      integrations={integrations}
      onConnected={() => settle(onConnected)}
      onDismiss={() => settle(onDeclined)}
      onOAuthStart={(url) => {
        saveMcpConnectionResume(
          detail ?? `Continue after connecting ${provider}.`,
          target,
        );
        navigateToMcpOAuthStart(url);
      }}
    />
  );
}

export interface McpAgentKitConnectionResumeProps {
  onResume: (
    target: McpAgentKitConnectionTarget,
    request: McpConnectionResumeRequest,
  ) => void | Promise<void>;
  onMessageResume?: (
    request: McpConnectionResumeRequest,
  ) => void | Promise<void>;
}

export function McpAgentKitConnectionResume({
  onResume,
  onMessageResume,
}: McpAgentKitConnectionResumeProps) {
  useEffect(() => {
    const pending: McpConnectionResumeRequest | null =
      consumeMcpConnectionResume();
    if (pending?.agentKit) {
      void Promise.resolve(onResume(pending.agentKit, pending)).catch(() => {});
    } else if (pending) {
      void Promise.resolve(onMessageResume?.(pending)).catch(() => {});
    }
  }, [onMessageResume, onResume]);
  return null;
}
