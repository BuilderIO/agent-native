import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import {
  isMcpIntegrationCatalogAvailable,
  useCreateMcpServer,
} from "@agent-native/core/client/resources";
import { mcpIntegrationLogo } from "@agent-native/core/client/resources/mcp-integration-logos";
import type { ComposerContextMenuItem } from "@agent-native/toolkit/composer";
import type {
  WorkspaceComposerMenuContribution,
  WorkspaceComposerMenuOptions,
} from "@agent-native/toolkit/composer/runtime-adapters";
import { IconPlugConnected, IconPlus } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { McpIntegrationDialogDeferred } from "../../resources/index.js";
import { useAgentKitCapabilities } from "./use-agentkit-capabilities.js";

export function useWorkspaceComposerMenu({
  onSelectIntegration,
  onRestoreFocus,
  enabled,
}: WorkspaceComposerMenuOptions): WorkspaceComposerMenuContribution {
  const t = useT();
  const capabilities = useAgentKitCapabilities({ enabled });
  const { data: org } = useOrg();
  const createMcp = useCreateMcpServer();
  const canCreateOrgMcp =
    !org?.orgId || org.role === "owner" || org.role === "admin";
  const [open, setOpen] = useState(false);
  const scope = useMemo(
    () => ({ key: capabilities.scopeKey }),
    [capabilities.scopeKey],
  );
  const latest = useRef({ capabilities, onSelectIntegration, scope });
  latest.current = { capabilities, onSelectIntegration, scope };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => setOpen(false), [scope]);
  const items: ComposerContextMenuItem[] = (
    capabilities.data?.integrations ?? []
  ).map((integration) => ({
    id: `workspace-integration:${integration.id}`,
    section: "integrations",
    label: integration.label,
    icon: mcpIntegrationLogo(integration.id) ? (
      <img
        src={mcpIntegrationLogo(integration.id)}
        alt=""
        className="size-4 object-contain"
      />
    ) : (
      <IconPlugConnected />
    ),
    onSelect: () => {
      const current = latest.current;
      if (
        !mounted.current ||
        current.scope !== scope ||
        current.capabilities.integrationsError ||
        current.capabilities.integrationsLoading ||
        !current.capabilities.data?.integrations.some(
          (entry) => entry.id === integration.id,
        )
      ) {
        throw new Error(t("agentChat.composer.integrations.loadFailed"));
      }
      current.onSelectIntegration({
        label: integration.label,
        refType: "integration",
        refId: integration.id,
        refPath: integration.id,
        source: "workspace-integration",
        icon: "integration",
      });
    },
  }));
  if (isMcpIntegrationCatalogAvailable())
    items.push({
      id: "workspace-connect-integrations",
      section: "integrations",
      order: 1000,
      opensDialog: true,
      label: t("agentChat.composer.integrations.connect"),
      icon: <IconPlus />,
      onSelect: () => setOpen(true),
    });
  return {
    items,
    scopeKey: capabilities.scopeKey,
    loading: capabilities.integrationsLoading,
    ...(capabilities.integrationsError
      ? { error: t("agentChat.composer.integrations.loadFailed") }
      : {}),
    onRetry: capabilities.refetchIntegrations,
    overlays: (
      <McpIntegrationDialogDeferred
        open={open}
        onOpenChange={setOpen}
        onCloseAutoFocus={(event) => {
          if (
            onRestoreFocus &&
            mounted.current &&
            latest.current.scope === scope
          ) {
            event.preventDefault();
            onRestoreFocus();
          }
        }}
        defaultScope={org?.orgId && !canCreateOrgMcp ? "user" : "org"}
        canCreateOrgMcp={canCreateOrgMcp}
        hasOrg={Boolean(org?.orgId)}
        onCreateMcpServer={(args) => createMcp.mutateAsync(args)}
      />
    ),
  };
}
