import {
  ComposerRuntimeAdaptersProvider,
  type ComposerRuntimeAdapters,
} from "@agent-native/toolkit/composer";
import { useMemo, type ReactNode } from "react";

import {
  DEFAULT_REASONING_EFFORT,
  getReasoningEffortOptionsForModel,
  reasoningEffortLabel,
  resolveReasoningEffortSelection,
} from "../../shared/reasoning-effort.js";
import { applyVoiceContextReplacements } from "../../voice/index.js";
import {
  formatAgentChatContextItemsForPrompt,
  normalizeAgentComposerReference,
  requestAgentChatThreadOpen,
  sendToAgentChat,
  setAgentChatContextItem,
} from "../agent-chat.js";
import { SIDEBAR_STATE_CHANGE_EVENT } from "../agent-sidebar-state.js";
import { agentNativePath } from "../api-path.js";
import { readClientAppState, setClientAppState } from "../application-state.js";
import { AssistantUiStaleIndexErrorBoundary } from "../assistant-ui-recovery.js";
import { getBrowserTabId } from "../browser-tab-id.js";
import {
  isTrustedBuilderMessage,
  tryDelegateBuildRequestToBuilder,
} from "../builder-frame.js";
import { BuilderSetupCard, BuilderSetupContent } from "../chat/run-recovery.js";
import { isTrustedFrameMessage } from "../frame.js";
import { useT } from "../i18n.js";
import { useOrg } from "../org/hooks.js";
import { isMcpIntegrationCatalogAvailable } from "../resources/mcp-integration-catalog.js";
import { McpIntegrationDialog } from "../resources/McpIntegrationDialog.js";
import { useCreateMcpServer } from "../resources/use-mcp-servers.js";
import { useBuilderConnectFlow } from "../settings/useBuilderStatus.js";
import {
  fetchAgentEngineConfiguredState,
  useAgentEngineConfigured,
} from "../use-agent-engine-configured.js";
import { useChatModels } from "../use-chat-models.js";
import { useVoiceProviderStatus } from "../voice-provider-status.js";

const REALTIME_VOICE_REQUEST_SOURCE = "realtime-voice";

function subscribeSidebarState(
  listener: (detail: { open?: boolean } | undefined) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handleStateChange = (event: Event) => {
    listener((event as CustomEvent<{ open?: boolean } | undefined>).detail);
  };
  window.addEventListener(SIDEBAR_STATE_CHANGE_EVENT, handleStateChange);
  return () =>
    window.removeEventListener(SIDEBAR_STATE_CHANGE_EVENT, handleStateChange);
}

const coreComposerAdapters: Omit<ComposerRuntimeAdapters, "translate"> = {
  resolvePath: agentNativePath,
  models: {
    useChatModels,
    useAgentEngineConfigured,
    fetchAgentEngineConfiguredState,
    BuilderSetupCard,
    BuilderSetupContent,
    reasoning: {
      defaultEffort: DEFAULT_REASONING_EFFORT,
      getOptionsForModel: getReasoningEffortOptionsForModel,
      label: reasoningEffortLabel,
      resolve: resolveReasoningEffortSelection,
    },
  },
  agentChat: {
    sendToAgentChat,
    setContextItem: setAgentChatContextItem,
    requestThreadOpen: requestAgentChatThreadOpen,
    formatContextItems: (items) =>
      items ? formatAgentChatContextItemsForPrompt(items) : "",
    normalizeReference: normalizeAgentComposerReference,
    StaleIndexBoundary: AssistantUiStaleIndexErrorBoundary,
  },
  builder: {
    useConnectFlow: useBuilderConnectFlow,
    tryDelegateBuildRequest: tryDelegateBuildRequestToBuilder,
    isTrustedBuilderMessage,
    isTrustedFrameMessage,
  },
  resources: {
    useOrg,
    isMcpIntegrationAvailable: isMcpIntegrationCatalogAvailable,
    useCreateMcpServer,
    McpIntegrationDialog,
  },
  voice: {
    useProviderStatus: useVoiceProviderStatus,
    getBrowserTabId,
    readAppState: readClientAppState,
    setAppState: (key, value) =>
      setClientAppState(key, value, {
        requestSource: REALTIME_VOICE_REQUEST_SOURCE,
      }),
    subscribeSidebarState,
    applyContextReplacements: applyVoiceContextReplacements,
  },
};

export function CoreComposerRuntimeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const translate = useT();
  const adapters = useMemo(
    () => ({ ...coreComposerAdapters, translate }),
    [translate],
  );
  return (
    <ComposerRuntimeAdaptersProvider adapters={adapters}>
      {children}
    </ComposerRuntimeAdaptersProvider>
  );
}
