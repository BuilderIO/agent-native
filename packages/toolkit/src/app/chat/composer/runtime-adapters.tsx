import { toPublicFrameworkPath } from "@agent-native/core/shared/framework-route-prefix";

function publicFrameworkPathInBrowser(path: string): string {
  return toPublicFrameworkPath(path, { publicPrefix: frameworkRoutePrefix() });
}
import {
  formatAgentChatContextItemsForPrompt,
  normalizeAgentComposerReference,
  requestAgentChatThreadOpen,
  sendToAgentChat,
  setAgentChatContextItem,
} from "@agent-native/core/client/agent-chat";
import { useVoiceProviderStatus } from "@agent-native/core/client/agent-chat";
import { SIDEBAR_STATE_CHANGE_EVENT } from "@agent-native/core/client/agent-chat";
import {
  appPath,
  frameworkRoutePrefix,
} from "@agent-native/core/client/api-path";
import {
  readClientAppState,
  setClientAppState,
} from "@agent-native/core/client/application-state";
import { getBrowserTabId } from "@agent-native/core/client/hooks";
import {
  isTrustedBuilderMessage,
  isTrustedFrameMessage,
  tryDelegateBuildRequestToBuilder,
} from "@agent-native/core/client/host";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import {
  isMcpIntegrationCatalogAvailable,
  useCreateMcpServer,
} from "@agent-native/core/client/resources";
import { applyVoiceContextReplacements } from "@agent-native/core/voice";
import {
  ComposerRuntimeAdaptersProvider,
  type ComposerRuntimeAdapters,
} from "@agent-native/toolkit/composer/runtime-adapters";
import { useMemo, type ReactNode } from "react";

import { McpIntegrationDialogDeferred } from "../../resources/index.js";
import {
  BuilderConnectPopover as DeferredBuilderConnectPopover,
  useBuilderConnectFlow,
} from "../../settings/index.js";
import { BuilderSetupCard, BuilderSetupContent } from "../chat/run-recovery.js";
import { AssistantUiStaleIndexErrorBoundary } from "./assistant-ui-recovery.js";
import { coreComposerModelAdapters } from "./model-runtime-adapters.js";

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

type CoreComposerRuntimeAdapters = Omit<ComposerRuntimeAdapters, "translate">;

export const coreComposerAdapters: CoreComposerRuntimeAdapters = {
  resolvePath: (path) => appPath(publicFrameworkPathInBrowser(path)),
  models: {
    ...coreComposerModelAdapters,
    BuilderSetupCard,
    BuilderSetupContent,
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
    BuilderConnectPopover: DeferredBuilderConnectPopover,
    tryDelegateBuildRequest: tryDelegateBuildRequestToBuilder,
    isTrustedBuilderMessage,
    isTrustedFrameMessage,
  },
  resources: {
    useOrg,
    isMcpIntegrationAvailable: isMcpIntegrationCatalogAvailable,
    useCreateMcpServer,
    McpIntegrationDialog: McpIntegrationDialogDeferred,
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
  const formatters = useFormatters();
  const formatNumber = useMemo(
    () => formatters.formatNumber.bind(formatters),
    [formatters],
  );
  const adapters = useMemo(
    () => ({ ...coreComposerAdapters, formatNumber, translate }),
    [formatNumber, translate],
  );
  return (
    <ComposerRuntimeAdaptersProvider adapters={adapters}>
      {children}
    </ComposerRuntimeAdaptersProvider>
  );
}
