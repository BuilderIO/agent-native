import type { AgentKitIntegrationCapability } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import type { ComposerContextMenuAction } from "@agent-native/toolkit/composer";
import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router";

import type { useAgentKitCapabilities } from "./use-agentkit-capabilities.js";

export function useAgentKitIntegrationMenu({
  capabilities,
  scopeKey,
  onSelect,
}: {
  capabilities: Pick<
    ReturnType<typeof useAgentKitCapabilities>,
    "data" | "integrationsLoading" | "integrationsError" | "refetchIntegrations"
  > &
    Partial<Pick<ReturnType<typeof useAgentKitCapabilities>, "scopeKey">>;
  scopeKey: string;
  onSelect: (integration: AgentKitIntegrationCapability) => void;
}): ComposerContextMenuAction {
  const t = useT();
  const pickerScopeKey = JSON.stringify([scopeKey, capabilities.scopeKey]);
  const currentScope = useMemo(
    () => ({ key: pickerScopeKey }),
    [pickerScopeKey],
  );
  const latest = useRef({ capabilities, currentScope, onSelect });
  latest.current = { capabilities, currentScope, onSelect };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const integrations =
    capabilities.integrationsError || capabilities.integrationsLoading
      ? []
      : (capabilities.data?.integrations ?? []);
  const error = capabilities.integrationsError
    ? t("agentChat.composer.integrations.loadFailed")
    : undefined;
  return {
    id: "integrations",
    label: t("agentChat.composer.menu.integrations"),
    intent: "invoke-integration",
    picker: {
      scopeKey: pickerScopeKey,
      searchPlaceholder: t("mcpIntegrations.searchPlaceholder"),
      items: integrations.map((integration) => ({
        id: integration.id,
        title: integration.label,
      })),
      loading: capabilities.integrationsLoading,
      error,
      onRetry: capabilities.refetchIntegrations,
      emptyMessage: t(
        integrations.length
          ? "mcpIntegrations.noMatches"
          : "agentChat.composer.integrations.empty",
      ),
      footerAction: {
        label: t(
          integrations.length || error || capabilities.integrationsLoading
            ? "agentChat.composer.integrations.manage"
            : "agentChat.composer.integrations.connect",
        ),
        renderLink: (children) => (
          <Link to={buildSettingsRoute("integrations")}>{children}</Link>
        ),
      },
      onSelect: (item) => {
        const current = latest.current;
        const integration = current.capabilities.data?.integrations.find(
          (entry) => entry.id === item.id,
        );
        if (
          !mounted.current ||
          current.currentScope !== currentScope ||
          current.capabilities.integrationsError ||
          current.capabilities.integrationsLoading ||
          !integration
        )
          throw new Error(t("agentChat.composer.integrations.loadFailed"));
        current.onSelect(integration);
      },
    },
  };
}
