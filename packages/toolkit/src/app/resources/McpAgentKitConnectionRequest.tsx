import type { AgentConnectionRequest } from "@agent-native/agentkit/protocol";
import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  getWorkspaceConnectionProvider,
  workspaceProviderOAuthUrl,
} from "@agent-native/core/client/integrations";
import { openOAuthPopup } from "@agent-native/core/client/oauth-popup";
import {
  addMcpConnectionCompleteListener,
  clearMcpConnectionResume,
  getPendingMcpConnectionResume,
  saveMcpConnectionResume,
  type McpConnectionResumeRequest,
} from "@agent-native/core/client/resources/mcp-connection-resume";
import {
  getDefaultMcpIntegrations,
  navigateToMcpOAuthStart,
} from "@agent-native/core/client/resources/mcp-integration-catalog";
import { IconAlertCircle } from "@tabler/icons-react";
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
  const [workspaceSetupOpened, setWorkspaceSetupOpened] = useState(false);
  const integrations = useMemo(() => getDefaultMcpIntegrations(), []);
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
            const setupWindow = window.open("", "_blank");
            if (!setupWindow) return false;
            try {
              setupWindow.opener = null;
              setupWindow.location.assign(
                dispatchIntegrationsHref(workspaceApps),
              );
            } catch {
              setupWindow.close();
              return false;
            }
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
          const completionId = crypto.randomUUID();
          const message = detail ?? `Continue after connecting ${provider}.`;
          if (!saveMcpConnectionResume(message, target, completionId)) {
            popup.close();
            return false;
          }
          const returnUrl = new URL(
            agentNativePath("/_agent-native/oauth/popup"),
            window.location.href,
          );
          returnUrl.searchParams.set("complete", "workspace-connection");
          returnUrl.searchParams.set("resume", completionId);
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
            clearMcpConnectionResume(completionId);
            popup.close();
            throw error;
          }
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
  const t = useT();
  const onResumeRef = useRef(onResume);
  const onMessageResumeRef = useRef(onMessageResume);
  const processingRef = useRef(false);
  const [failed, setFailed] = useState(false);
  onResumeRef.current = onResume;
  onMessageResumeRef.current = onMessageResume;

  useEffect(() => {
    const resumePending = async () => {
      if (processingRef.current) return;
      const pending = getPendingMcpConnectionResume();
      if (!pending) return;
      processingRef.current = true;
      try {
        if (pending.agentKit) {
          try {
            await onResumeRef.current(pending.agentKit, pending);
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !error.message.startsWith("Unknown AgentKit run:") ||
              !onMessageResumeRef.current
            ) {
              throw error;
            }
            await onMessageResumeRef.current(pending);
          }
        } else {
          if (!onMessageResumeRef.current) return;
          await onMessageResumeRef.current(pending);
        }
        clearMcpConnectionResume(pending);
        setFailed(false);
      } finally {
        processingRef.current = false;
      }
    };
    const resume = () => {
      void resumePending().catch(() => setFailed(true));
    };
    resume();
    return addMcpConnectionCompleteListener(resume);
  }, []);
  return failed ? (
    <div className="agentkit-command-error" role="alert">
      <IconAlertCircle aria-hidden="true" className="agentkit-icon" />
      <span>{t("agentChat.connection.failed")}</span>
    </div>
  ) : null;
}
