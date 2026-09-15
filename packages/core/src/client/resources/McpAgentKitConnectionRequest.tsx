import { useEffect, useMemo, useRef, type ReactNode } from "react";

import {
  consumeMcpConnectionResume,
  saveMcpConnectionResume,
  type McpConnectionResumeRequest,
} from "./mcp-connection-resume.js";
import {
  getDefaultMcpIntegrations,
  navigateToMcpOAuthStart,
} from "./mcp-integration-catalog.js";
import { McpConnectionSuggestion } from "./McpConnectionSuggestion.js";

export interface McpAgentKitConnectionTarget {
  threadId: string;
  runId: string;
  requestId: string;
}

export interface McpAgentKitConnectionRequestCardProps {
  provider: string;
  detail?: string;
  target: McpAgentKitConnectionTarget;
  onConnected: () => void | Promise<void>;
  onDeclined: () => void | Promise<void>;
  fallback?: ReactNode;
}

/**
 * Resolves a structured AgentKit provider request through Core's trusted MCP
 * catalog and standard connection dialog. Agent-authored URLs and scopes never
 * cross this boundary.
 */
export function McpAgentKitConnectionRequestCard({
  provider,
  detail,
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

/** Resolves a paused AgentKit run after an OAuth round trip returns to Chat. */
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
