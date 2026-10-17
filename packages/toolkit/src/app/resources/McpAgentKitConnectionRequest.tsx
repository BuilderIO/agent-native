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
import { Button } from "@agent-native/toolkit/ui/button";
import { IconAlertCircle, IconLoader2 } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AgentConnectionRequestCard } from "../agentkit/react/components.js";
import {
  dispatchApiKeysHref,
  useOrgSwitcherAppLinks,
} from "../org/workspace-app-links.js";
import {
  findMcpConnectionSuggestionIntegration,
  McpConnectionSuggestion,
} from "./McpConnectionSuggestion.js";

export interface McpAgentKitConnectionTarget {
  threadId: string;
  runId: string;
  requestId: string;
}

const EXCLUDED_CONNECTION_REQUEST_HANDLED_KEY =
  "agent-native:excluded-connection-request-handled";
const handledExcludedConnectionRequests = new Set<string>();

type ExcludedConnectionRequestMarker = "handled" | "unhandled" | "unavailable";

function excludedConnectionRequestStorageKey(
  target: McpAgentKitConnectionTarget,
) {
  return `${EXCLUDED_CONNECTION_REQUEST_HANDLED_KEY}:${JSON.stringify([
    target.threadId,
    target.runId,
    target.requestId,
  ])}`;
}

function getExcludedConnectionRequestMarker(
  storageKey: string,
): ExcludedConnectionRequestMarker {
  if (handledExcludedConnectionRequests.has(storageKey)) return "handled";
  if (typeof window === "undefined") return "unavailable";
  try {
    return window.sessionStorage.getItem(storageKey) === "1"
      ? "handled"
      : "unhandled";
  } catch {
    return "unavailable";
  }
}

function markExcludedConnectionRequestHandled(
  storageKey: string,
  markerWasUnavailable: boolean,
) {
  if (markerWasUnavailable) {
    handledExcludedConnectionRequests.add(storageKey);
  }
  if (typeof window === "undefined") {
    handledExcludedConnectionRequests.add(storageKey);
    return;
  }
  try {
    window.sessionStorage.setItem(storageKey, "1");
  } catch {
    handledExcludedConnectionRequests.add(storageKey);
  }
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
  excludedIntegrationIds?: readonly string[];
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
  excludedIntegrationIds,
  fallback = null,
}: McpAgentKitConnectionRequestCardProps) {
  const t = useT();
  const settledRef = useRef(false);
  const onDeclinedRef = useRef(onDeclined);
  const [excludedRequestResolutionFailed, setExcludedRequestResolutionFailed] =
    useState(false);
  const [
    excludedRequestResolutionPending,
    setExcludedRequestResolutionPending,
  ] = useState(false);
  onDeclinedRef.current = onDeclined;
  const targetKey = excludedConnectionRequestStorageKey(target);
  const [workspaceSetupOpened, setWorkspaceSetupOpened] = useState(false);
  const integrations = useMemo(() => getDefaultMcpIntegrations(), []);
  const excludedIds = new Set(
    excludedIntegrationIds?.map((id) => id.trim().toLowerCase()) ?? [],
  );
  const normalizedProvider = provider.trim().toLowerCase();
  const catalogIntegration = integrations.find(
    (candidate) =>
      candidate.id.toLowerCase() === normalizedProvider ||
      candidate.provider.toLowerCase() === normalizedProvider,
  );
  const integrationExcluded =
    excludedIds.has(normalizedProvider) ||
    (source?.kind === "workspace_connection" &&
      excludedIds.has(source.id.trim().toLowerCase())) ||
    Boolean(
      catalogIntegration &&
      (excludedIds.has(catalogIntegration.id.toLowerCase()) ||
        excludedIds.has(catalogIntegration.provider.toLowerCase())),
    );
  const integration = findMcpConnectionSuggestionIntegration({
    text: detail ?? "",
    requestedByAgent: true,
    integrationId: provider,
    integrations,
    excludedIntegrationIds,
  });
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
  const resolveExcludedRequest = useCallback(() => {
    if (settledRef.current) return;
    const marker = getExcludedConnectionRequestMarker(targetKey);
    if (marker === "handled") {
      settledRef.current = true;
      return;
    }
    settledRef.current = true;
    setExcludedRequestResolutionPending(true);
    void Promise.resolve()
      .then(() => onDeclinedRef.current())
      .then(() => {
        markExcludedConnectionRequestHandled(
          targetKey,
          marker === "unavailable",
        );
        setExcludedRequestResolutionFailed(false);
      })
      .catch(() => {
        settledRef.current = false;
        setExcludedRequestResolutionFailed(true);
      })
      .finally(() => {
        setExcludedRequestResolutionPending(false);
      });
  }, [targetKey]);
  useEffect(() => {
    if (!integrationExcluded || status !== "requested") return;
    resolveExcludedRequest();
  }, [integrationExcluded, resolveExcludedRequest, status]);
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
  if (integrationExcluded) {
    return excludedRequestResolutionFailed ? (
      <div className="agentkit-command-error" role="alert">
        <IconAlertCircle aria-hidden="true" className="agentkit-icon" />
        <span>{t("agentChat.connection.failed")}</span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={excludedRequestResolutionPending}
          onClick={resolveExcludedRequest}
        >
          {excludedRequestResolutionPending ? (
            <IconLoader2 aria-hidden="true" className="animate-spin" />
          ) : null}
          {t("agentChat.common.retry")}
        </Button>
      </div>
    ) : (
      fallback
    );
  }
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
              setupWindow.location.assign(dispatchApiKeysHref(workspaceApps));
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
      excludedIntegrationIds={excludedIntegrationIds}
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

/**
 * Returned by `onResume` when the saved request belongs to another chat. The
 * record is left for its owner, so nothing is cleared, retried, or reported.
 */
export type McpAgentKitResumeNotOwned = "not-owner";

export interface McpAgentKitConnectionResumeProps {
  onResume: (
    target: McpAgentKitConnectionTarget,
    request: McpConnectionResumeRequest,
  ) =>
    | void
    | McpAgentKitResumeNotOwned
    | Promise<void | McpAgentKitResumeNotOwned>;
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
      setFailed(false);
      try {
        if (pending.agentKit) {
          try {
            const outcome = await onResumeRef.current(
              pending.agentKit,
              pending,
            );
            if (outcome === "not-owner") return;
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
