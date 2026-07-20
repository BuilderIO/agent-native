import {
  DEFAULT_MCP_INTEGRATIONS as RUNTIME_DEFAULT_MCP_INTEGRATIONS,
  McpConnectionSuggestion as RuntimeMcpConnectionSuggestion,
  McpIntegrationDialog as RuntimeMcpIntegrationDialog,
  ResourcesPanel as RuntimeResourcesPanel,
  filterMcpIntegrations as filterRuntimeMcpIntegrations,
  findMcpIntegrationForText as findRuntimeMcpIntegrationForText,
  getDefaultMcpIntegrations as getRuntimeDefaultMcpIntegrations,
  isCustomMcpIntegrationEnabled,
  mergeDefaultMcpIntegrations as mergeRuntimeDefaultMcpIntegrations,
  type DefaultMcpIntegration,
  type McpConnectionSuggestionProps,
  type McpIntegrationDialogProps,
  type ResourcesPanelProps,
} from "@agent-native/core/client/resources/runtime";
import { createElement, type ComponentType, type ReactElement } from "react";

export * from "@agent-native/core/client/resources/runtime";

function preset(id: string): DefaultMcpIntegration {
  return {
    ...RUNTIME_DEFAULT_MCP_INTEGRATIONS.find(
      (integration) => integration.id === id,
    )!,
  };
}

export const DEFAULT_MCP_INTEGRATIONS: DefaultMcpIntegration[] = [
  preset("context7"),
  preset("sentry"),
  preset("notion"),
  preset("semgrep"),
  preset("linear"),
  preset("atlassian"),
  preset("supabase"),
  preset("neon"),
  preset("stripe"),
  preset("cloudflare"),
  preset("gitlab"),
  preset("figma"),
  preset("canva"),
  preset("vercel"),
  preset("github"),
  preset("slack"),
  preset("asana"),
  preset("hubspot"),
  preset("intercom"),
  preset("monday"),
  preset("webflow"),
  preset("paypal"),
  preset("box"),
  preset("netlify"),
  preset("zapier"),
];

export const defaultMcpIntegrationOverrides = DEFAULT_MCP_INTEGRATIONS;

export function mergeDefaultMcpIntegrations(
  overrides: readonly DefaultMcpIntegration[] = [],
): DefaultMcpIntegration[] {
  return mergeRuntimeDefaultMcpIntegrations([
    ...defaultMcpIntegrationOverrides,
    ...overrides,
  ]);
}

export function getDefaultMcpIntegrations(
  config?: Parameters<typeof getRuntimeDefaultMcpIntegrations>[0],
  overrides: readonly DefaultMcpIntegration[] = [],
): DefaultMcpIntegration[] {
  return getRuntimeDefaultMcpIntegrations(config, [
    ...defaultMcpIntegrationOverrides,
    ...overrides,
  ]);
}

export function isMcpIntegrationCatalogAvailable(
  config?: Parameters<typeof getRuntimeDefaultMcpIntegrations>[0],
): boolean {
  return (
    isCustomMcpIntegrationEnabled(config) ||
    getDefaultMcpIntegrations(config).length > 0
  );
}

export function filterMcpIntegrations(
  query: string,
  integrations: DefaultMcpIntegration[] = getDefaultMcpIntegrations(),
): DefaultMcpIntegration[] {
  return filterRuntimeMcpIntegrations(query, integrations);
}

export function findMcpIntegrationForText(
  text: string,
  integrations: DefaultMcpIntegration[] = getDefaultMcpIntegrations(),
): DefaultMcpIntegration | null {
  return findRuntimeMcpIntegrationForText(text, integrations);
}

function withUiIntegrations(
  integrations: readonly DefaultMcpIntegration[] = [],
): DefaultMcpIntegration[] {
  return mergeDefaultMcpIntegrations(integrations);
}

export function McpIntegrationDialog(
  props: McpIntegrationDialogProps,
): ReactElement {
  return createElement(RuntimeMcpIntegrationDialog, {
    ...props,
    integrations: withUiIntegrations(props.integrations),
  });
}

export function McpConnectionSuggestion(
  props: McpConnectionSuggestionProps,
): ReactElement {
  return createElement(RuntimeMcpConnectionSuggestion, {
    ...props,
    integrations: withUiIntegrations(props.integrations),
  });
}

type EjectedResourcesPanelProps = ResourcesPanelProps & {
  mcpIntegrations?: DefaultMcpIntegration[];
};

export function ResourcesPanel(
  props: EjectedResourcesPanelProps = {},
): ReactElement {
  const Component =
    RuntimeResourcesPanel as ComponentType<EjectedResourcesPanelProps>;
  return createElement(Component, {
    ...props,
    mcpIntegrations: withUiIntegrations(props.mcpIntegrations),
  });
}
