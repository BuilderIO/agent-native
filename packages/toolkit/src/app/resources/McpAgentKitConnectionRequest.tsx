import type { AgentConnectionRequest } from "@agent-native/agentkit/protocol";
import { startWorkspaceProviderOAuth } from "@agent-native/core/client/integrations";
import {
  consumeMcpConnectionResume,
  saveMcpConnectionResume,
  type McpConnectionResumeRequest,
} from "@agent-native/core/client/resources/mcp-connection-resume";
import {
  getDefaultMcpIntegrations,
  navigateToMcpOAuthStart,
} from "@agent-native/core/client/resources/mcp-integration-catalog";
import { getWorkspaceConnectionProvider } from "@agent-native/core/connections";
import { useEffect, useMemo, useRef, type ReactNode } from "react";

import { AgentConnectionRequestCard } from "../agentkit/react/components.js";
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
  appId,
  source,
  target,
  onConnected,
  onDeclined,
  fallback = null,
}: McpAgentKitConnectionRequestCardProps) {
  const settledRef = useRef(false);
  const integrations = useMemo(() => getDefaultMcpIntegrations(), []);
  const integration = integrations.find(
    (candidate) =>
      candidate.id.toLowerCase() === provider.trim().toLowerCase() ||
      candidate.provider.toLowerCase() === provider.trim().toLowerCase(),
  );
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
    const workspaceProvider =
      source.id === provider ? getWorkspaceConnectionProvider(source.id) : null;
    if (!workspaceProvider?.oauth || !appId) return fallback;
    const request: AgentConnectionRequest = {
      id: target.requestId,
      provider,
      reason: reason ?? "connect",
      status: "requested",
      appId,
      detail,
      source,
    };
    return (
      <AgentConnectionRequestCard
        request={request}
        runId={target.runId}
        providerLabel={source.label}
        onConnect={() => {
          if (
            !saveMcpConnectionResume(
              detail ??
                `Continue after connecting ${source.label ?? provider}.`,
            )
          ) {
            return false;
          }
          startWorkspaceProviderOAuth(source.id, {
            appId,
            scope: "user",
            returnPath:
              window.location.pathname +
              window.location.search +
              window.location.hash,
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
